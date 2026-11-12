package app.auralis.recognition.shazamkit

import android.os.SystemClock
import app.auralis.BuildConfig
import app.auralis.dsp.AudioDsp
import app.auralis.dsp.ProcessedAudio
import app.auralis.model.MatchMetadata
import app.auralis.model.TrackArtwork
import app.auralis.model.TrackLink
import app.auralis.model.TrackMatch
import app.auralis.recognition.AuralisApiClient
import app.auralis.recognition.RecognitionOutcome
import app.auralis.recognition.RecognitionProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.lang.reflect.Proxy
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.time.Instant

/**
 * Optional on-device ShazamKit recognition provider (`app.auralis.recognition.shazamkit.ShazamKitProvider`).
 *
 * Design:
 * - Compiles cleanly even when Apple's proprietary `app/libs/shazamkit-android-release.aar` is not present.
 * - Automatically detects `com.shazam.shazamkit.ShazamKit` at runtime (or when built with the `shazamkit`
 *   flavor where `BuildConfig.SHAZAMKIT_ENABLED == true`).
 * - Never embeds Apple developer keys in the client: fetches a short-lived ES256 developer JWT from
 *   `GET /api/v1/shazamkit/token` via [AuralisApiClient.fetchShazamKitToken].
 * - Normalizes any match into the Auralis [TrackMatch] contract schema with `confidence = null` per contract.
 */
class ShazamKitProvider(
    private val apiClient: AuralisApiClient
) : RecognitionProvider {

    override val id: String = "shazamkit"
    override val displayName: String = "On-Device Catalog (ShazamKit)"

    override val isAvailable: Boolean
        get() = isShazamKitClassPresent()

    @Volatile
    private var cachedToken: String? = null

    @Volatile
    private var cachedTokenExpiresEpochMs: Long = 0L

    override suspend fun recognize(
        audio: ProcessedAudio,
        source: String,
        preferredServerProvider: String?
    ): RecognitionOutcome = withContext(Dispatchers.Default) {
        if (!isAvailable) {
            return@withContext RecognitionOutcome.ServiceUnavailable(
                code = "NOT_CONFIGURED",
                message = "ShazamKit Android AAR is not bundled. Drop shazamkit-android-release.aar into android/app/libs/ to enable on-device ShazamKit recognition.",
                retryable = false
            )
        }

        val tokenResult = getOrRefreshDeveloperToken()
        val developerToken = tokenResult.getOrElse { err ->
            return@withContext RecognitionOutcome.ServiceUnavailable(
                code = "NOT_CONFIGURED",
                message = err.message ?: "Failed to fetch ShazamKit developer token from /api/v1/shazamkit/token.",
                retryable = false
            )
        }

        val startTime = SystemClock.elapsedRealtime()
        try {
            runReflectiveShazamKitSession(
                developerToken = developerToken,
                audio = audio,
                source = source,
                startTimeMs = startTime
            )
        } catch (t: Throwable) {
            RecognitionOutcome.ServiceUnavailable(
                code = "PROVIDER_UNAVAILABLE",
                message = "On-device ShazamKit failed: ${t.message ?: t::class.simpleName}",
                retryable = true
            )
        }
    }

    private suspend fun getOrRefreshDeveloperToken(): Result<String> {
        val now = System.currentTimeMillis()
        val existing = cachedToken
        if (!existing.isNullOrBlank() && now + 60_000L < cachedTokenExpiresEpochMs) {
            return Result.success(existing)
        }
        return apiClient.fetchShazamKitToken().map { resp ->
            cachedToken = resp.token
            cachedTokenExpiresEpochMs = runCatching {
                Instant.parse(resp.expiresAt).toEpochMilli()
            }.getOrDefault(now + 50 * 60_000L)
            resp.token
        }
    }

    /**
     * Bridges to `com.shazam.shazamkit.*` when `shazamkit-android-release.aar` is present on the classpath.
     */
    @Suppress("UNCHECKED_CAST")
    private suspend fun runReflectiveShazamKitSession(
        developerToken: String,
        audio: ProcessedAudio,
        source: String,
        startTimeMs: Long
    ): RecognitionOutcome {
        val shazamKitClass = Class.forName("com.shazam.shazamkit.ShazamKit")
        val shazamKitInstance = shazamKitClass.getField("INSTANCE").get(null)

        val devTokenClass = Class.forName("com.shazam.shazamkit.DeveloperToken")
        val devTokenCtor = devTokenClass.getConstructor(String::class.java)
        val devTokenObj = devTokenCtor.newInstance(developerToken)

        val tokenProviderInterface = Class.forName("com.shazam.shazamkit.DeveloperTokenProvider")
        val tokenProviderProxy = Proxy.newProxyInstance(
            tokenProviderInterface.classLoader,
            arrayOf(tokenProviderInterface)
        ) { _, method, _ ->
            if (method.name == "provideDeveloperToken") devTokenObj else null
        }

        val createCatalogMethod = shazamKitClass.methods.first {
            it.name == "createShazamCatalog" && it.parameterCount == 1
        }
        val catalogResult = createCatalogMethod.invoke(shazamKitInstance, tokenProviderProxy)
        val catalog = unwrapShazamKitResult(catalogResult)
            ?: return RecognitionOutcome.ServiceUnavailable(
                code = "PROVIDER_AUTH",
                message = "ShazamKit rejected the developer token.",
                retryable = false
            )

        val sampleRateEnumClass = Class.forName("com.shazam.shazamkit.AudioSampleRateInHz")
        val sampleRate16k = sampleRateEnumClass.enumConstants?.first {
            it.toString().contains("16000")
        } ?: error("AudioSampleRateInHz.SAMPLE_RATE_16000 not found")

        val createStreamingSessionMethod = shazamKitClass.methods.first {
            it.name == "createStreamingSession"
        }

        // Kotlin suspend function on ShazamKit: invoke via kotlinx.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn
        val sessionResult = kotlin.coroutines.intrinsics.suspendCoroutineUninterceptedOrReturn<Any?> { cont ->
            createStreamingSessionMethod.invoke(
                shazamKitInstance,
                catalog,
                sampleRate16k,
                8192,
                cont
            )
        }

        val streamingSession = unwrapShazamKitResult(sessionResult)
            ?: return RecognitionOutcome.ServiceUnavailable(
                code = "PROVIDER_UNAVAILABLE",
                message = "Could not create ShazamKit StreamingSession.",
                retryable = true
            )

        val matchStreamMethod = streamingSession.javaClass.getMethod("recognitionResults")
        val resultsFlow = matchStreamMethod.invoke(streamingSession) as Flow<Any>

        val pcmShorts = AudioDsp.floatToPcm16(audio.samples16k)
        val pcmByteBuf = ByteBuffer.allocate(pcmShorts.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        for (s in pcmShorts) {
            pcmByteBuf.putShort(s)
        }
        val pcmBytes = pcmByteBuf.array()

        val matchStreamPcmMethod = streamingSession.javaClass.methods.first {
            it.name == "matchStream" && it.parameterCount == 3
        }
        matchStreamPcmMethod.invoke(streamingSession, pcmBytes, pcmBytes.size, 0L)

        val matchResult = withTimeoutOrNull(12_000L) {
            resultsFlow.first()
        } ?: return RecognitionOutcome.NoMatch(
            providerId = id,
            providerName = "ShazamKit",
            latencyMs = SystemClock.elapsedRealtime() - startTimeMs
        )

        val latencyMs = SystemClock.elapsedRealtime() - startTimeMs
        val resultClassName = matchResult.javaClass.simpleName
        return when {
            resultClassName.contains("Match", ignoreCase = true) &&
                !resultClassName.contains("NoMatch", ignoreCase = true) -> {
                val track = extractTrackMatch(matchResult, source)
                if (track != null) {
                    RecognitionOutcome.Match(
                        track = track,
                        providerId = id,
                        providerName = "ShazamKit",
                        latencyMs = latencyMs
                    )
                } else {
                    RecognitionOutcome.NoMatch(
                        providerId = id,
                        providerName = "ShazamKit",
                        latencyMs = latencyMs
                    )
                }
            }
            resultClassName.contains("NoMatch", ignoreCase = true) -> {
                RecognitionOutcome.NoMatch(
                    providerId = id,
                    providerName = "ShazamKit",
                    latencyMs = latencyMs
                )
            }
            else -> {
                RecognitionOutcome.ServiceUnavailable(
                    code = "PROVIDER_UNAVAILABLE",
                    message = "ShazamKit returned an error during matching.",
                    retryable = true
                )
            }
        }
    }

    private fun unwrapShazamKitResult(resultObj: Any?): Any? {
        if (resultObj == null) return null
        val cls = resultObj.javaClass
        if (cls.simpleName.contains("Success", ignoreCase = true)) {
            return runCatching { cls.getMethod("getData").invoke(resultObj) }.getOrNull()
        }
        return null
    }

    private fun extractTrackMatch(matchResult: Any, source: String): TrackMatch? {
        val items = runCatching {
            matchResult.javaClass.getMethod("getMatchedMediaItems").invoke(matchResult) as? List<*>
        }.getOrNull()
        val firstItem = items?.firstOrNull() ?: return null
        val itemClass = firstItem.javaClass

        fun stringProp(getterName: String): String? =
            runCatching { itemClass.getMethod(getterName).invoke(firstItem)?.toString() }
                .getOrNull()
                ?.takeIf { it.isNotBlank() }

        val title = stringProp("getTitle") ?: return null
        val artist = stringProp("getArtist") ?: "Unknown Artist"
        val shazamId = stringProp("getShazamID") ?: "${title.hashCode()}"
        val isrc = stringProp("getIsrc")
        val artworkUrl = stringProp("getArtworkURL")
        val appleMusicUrl = stringProp("getAppleMusicURL")
        val webUrl = stringProp("getWebURL")
        val genres = runCatching {
            (itemClass.getMethod("getGenres").invoke(firstItem) as? List<*>)
                ?.mapNotNull { it?.toString() }
        }.getOrNull().orEmpty()

        val offsetMs = runCatching {
            val offsetSec = itemClass.getMethod("getPredictedCurrentMatchOffset").invoke(firstItem) as? Double
            offsetSec?.let { (it * 1000.0).toLong() }
        }.getOrNull()

        val timecode = offsetMs?.let { ms ->
            val totalSeconds = (ms / 1000L).coerceAtLeast(0L)
            val mins = totalSeconds / 60L
            val secs = totalSeconds % 60L
            "%02d:%02d".format(mins, secs)
        }

        val links = buildList {
            if (!appleMusicUrl.isNullOrBlank()) {
                add(TrackLink(service = "apple_music", url = appleMusicUrl, label = "Apple Music"))
            }
            if (!webUrl.isNullOrBlank()) {
                add(TrackLink(service = "shazam", url = webUrl, label = "Web Link"))
            }
        }

        return TrackMatch(
            id = if (!isrc.isNullOrBlank()) "isrc:$isrc" else "shazamkit:$shazamId",
            title = title,
            artists = listOf(artist),
            artist = artist,
            album = null,
            releaseDate = null,
            year = null,
            genres = genres,
            label = null,
            isrc = isrc,
            durationMs = null,
            artwork = artworkUrl?.let { TrackArtwork(url = it, thumbUrl = it) },
            previewUrl = null,
            links = links,
            match = MatchMetadata(
                provider = "shazamkit",
                offsetMs = offsetMs,
                timecode = timecode,
                confidence = null, // Contract rule: AudD/ShazamKit -> confidence is null
                recognizedAt = Instant.now().toString(),
                source = source,
                platform = "android"
            )
        )
    }

    companion object {
        fun isShazamKitClassPresent(): Boolean {
            return runCatching {
                Class.forName("com.shazam.shazamkit.ShazamKit")
                true
            }.getOrDefault(BuildConfig.SHAZAMKIT_ENABLED)
        }
    }
}
