package app.auralis.recognition

import app.auralis.dsp.ProcessedAudio
import app.auralis.model.ApiErrorEnvelope
import app.auralis.model.AuthCredentialsRequest
import app.auralis.model.AuthSessionResponse
import app.auralis.model.LibraryItem
import app.auralis.model.LibraryListResponse
import app.auralis.model.LibrarySyncRequest
import app.auralis.model.LibrarySyncResponse
import app.auralis.model.RecognizeResponse
import app.auralis.model.ServerConfigResponse
import app.auralis.model.ShazamKitTokenResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * HTTP client for the Auralis `/api/v1` contract.
 *
 * Sends `X-Auralis-Client: android/<version>` and `X-Auralis-Install: <installUuid>` on every
 * request, plus `Authorization: Bearer <sessionToken>` when signed in.
 */
class AuralisApiClient(
    private val baseUrlProvider: () -> String,
    private val installIdProvider: () -> String,
    private val authTokenProvider: () -> String?,
    private val clientVersion: String = "1.0.0",
    httpClient: OkHttpClient? = null
) {

    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
    }

    private val client: OkHttpClient = httpClient ?: OkHttpClient.Builder()
        .connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .writeTimeout(25, TimeUnit.SECONDS)
        .build()

    private fun buildUrl(path: String): String {
        val base = baseUrlProvider().trim().trimEnd('/')
        val cleanPath = if (path.startsWith("/")) path else "/$path"
        return "$base$cleanPath"
    }

    private fun Request.Builder.applyAuralisHeaders(): Request.Builder {
        val client = "android/$clientVersion"
        val install = installIdProvider()
        header("X-PlayIT-Client", client)
        header("X-PlayIT-Install", install)
        header("X-Auralis-Client", client)
        header("X-Auralis-Install", install)
        header("Accept", "application/json")
        val token = authTokenProvider()?.trim()
        if (!token.isNullOrEmpty()) {
            header("Authorization", "Bearer $token")
        }
        return this
    }

    suspend fun fetchConfig(): Result<ServerConfigResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url(buildUrl("/api/v1/config"))
                .applyAuralisHeaders()
                .get()
                .build()

            client.newCall(req).execute().use { resp ->
                val bodyStr = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val err = parseErrorEnvelope(bodyStr)
                    throw IOException(err?.error?.message ?: "HTTP ${resp.code}")
                }
                json.decodeFromString<ServerConfigResponse>(bodyStr)
            }
        }
    }

    suspend fun recognize(
        audio: ProcessedAudio,
        source: String,
        providerOverride: String? = null
    ): RecognitionOutcome = withContext(Dispatchers.IO) {
        val url = buildUrl("/api/v1/recognize")
        if (url.toHttpUrlOrNull() == null) {
            return@withContext RecognitionOutcome.ConnectionError(
                message = "Invalid API base URL: ${baseUrlProvider()}",
                retryable = false
            )
        }

        val wavBody = audio.wavBytes.toRequestBody("audio/wav".toMediaType())
        val multipartBuilder = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("audio", "sample.wav", wavBody)
            .addFormDataPart("source", source)
            .addFormDataPart("durationMs", audio.durationMs.toString())

        if (!providerOverride.isNullOrBlank() && providerOverride != "server") {
            multipartBuilder.addFormDataPart("provider", providerOverride)
        }

        val request = Request.Builder()
            .url(url)
            .applyAuralisHeaders()
            .post(multipartBuilder.build())
            .build()

        try {
            client.newCall(request).execute().use { response ->
                val bodyText = response.body?.string().orEmpty()
                val retryAfterHeader = response.header("Retry-After")?.toLongOrNull()

                if (response.isSuccessful) {
                    val parsed = try {
                        json.decodeFromString<RecognizeResponse>(bodyText)
                    } catch (e: Exception) {
                        return@withContext RecognitionOutcome.ServiceUnavailable(
                            code = "INVALID_RESPONSE",
                            message = "Malformed response from recognition server.",
                            retryable = true
                        )
                    }

                    val provId = parsed.provider?.id ?: (providerOverride ?: "server")
                    val provName = parsed.provider?.name ?: "Auralis Server"

                    return@withContext when (parsed.status) {
                        "match" -> {
                            val track = parsed.result
                            if (track != null) {
                                RecognitionOutcome.Match(
                                    track = track,
                                    providerId = provId,
                                    providerName = provName,
                                    latencyMs = parsed.latencyMs
                                )
                            } else {
                                RecognitionOutcome.NoMatch(
                                    providerId = provId,
                                    providerName = provName,
                                    latencyMs = parsed.latencyMs
                                )
                            }
                        }
                        "no_match" -> RecognitionOutcome.NoMatch(
                            providerId = provId,
                            providerName = provName,
                            latencyMs = parsed.latencyMs
                        )
                        else -> RecognitionOutcome.NoMatch(
                            providerId = provId,
                            providerName = provName,
                            latencyMs = parsed.latencyMs
                        )
                    }
                }

                return@withContext mapHttpErrorToOutcome(
                    httpCode = response.code,
                    bodyText = bodyText,
                    retryAfterSeconds = retryAfterHeader
                )
            }
        } catch (ioe: IOException) {
            RecognitionOutcome.ConnectionError(
                message = "Could not connect to server (${ioe.message ?: "network error"}).",
                retryable = true
            )
        } catch (t: Throwable) {
            RecognitionOutcome.ConnectionError(
                message = "Unexpected request failure: ${t.message ?: t::class.simpleName}",
                retryable = true
            )
        }
    }

    /**
     * Maps contract error codes and HTTP status codes to [RecognitionOutcome] (and thus [app.auralis.model.RecognitionState]):
     * - AUDIO_SILENT (422) -> TooQuiet (`too_quiet`)
     * - AUDIO_TOO_SHORT (422) -> TooQuiet / user message
     * - RATE_LIMITED (429), PROVIDER_AUTH (503), PROVIDER_QUOTA (503), PROVIDER_UNAVAILABLE (503),
     *   NOT_CONFIGURED (503), UNSUPPORTED_FORMAT (415), PAYLOAD_TOO_LARGE (413), UNAUTHORIZED (401),
     *   INTERNAL (500) -> ServiceUnavailable (`service_unavailable`)
     */
    fun mapHttpErrorToOutcome(
        httpCode: Int,
        bodyText: String,
        retryAfterSeconds: Long? = null
    ): RecognitionOutcome {
        val envelope = parseErrorEnvelope(bodyText)
        val code = envelope?.error?.code ?: when (httpCode) {
            401 -> "UNAUTHORIZED"
            413 -> "PAYLOAD_TOO_LARGE"
            415 -> "UNSUPPORTED_FORMAT"
            422 -> "AUDIO_SILENT"
            429 -> "RATE_LIMITED"
            503 -> "PROVIDER_UNAVAILABLE"
            else -> "INTERNAL"
        }
        val serverMessage = envelope?.error?.message?.takeIf { it.isNotBlank() }
        val retryable = envelope?.error?.retryable ?: (httpCode == 429 || httpCode >= 500)

        return when (code) {
            "AUDIO_SILENT" -> RecognitionOutcome.TooQuiet(
                message = serverMessage ?: "Move closer to the music or turn it up"
            )
            "AUDIO_TOO_SHORT" -> RecognitionOutcome.TooQuiet(
                message = serverMessage ?: "Audio sample was too short (minimum 4 seconds required)."
            )
            "RATE_LIMITED" -> {
                val waitSuffix = retryAfterSeconds?.let { " Try again in ${it}s." }.orEmpty()
                RecognitionOutcome.ServiceUnavailable(
                    code = code,
                    message = (serverMessage ?: "Rate limit reached.") + waitSuffix,
                    retryable = true,
                    retryAfterSeconds = retryAfterSeconds
                )
            }
            "NOT_CONFIGURED",
            "PROVIDER_AUTH",
            "PROVIDER_QUOTA",
            "PROVIDER_UNAVAILABLE",
            "UNSUPPORTED_FORMAT",
            "PAYLOAD_TOO_LARGE",
            "UNAUTHORIZED",
            "INTERNAL" -> RecognitionOutcome.ServiceUnavailable(
                code = code,
                message = serverMessage ?: defaultMessageForErrorCode(code, httpCode),
                retryable = retryable,
                retryAfterSeconds = retryAfterSeconds
            )
            else -> RecognitionOutcome.ServiceUnavailable(
                code = code,
                message = serverMessage ?: "Recognition service error (HTTP $httpCode).",
                retryable = retryable,
                retryAfterSeconds = retryAfterSeconds
            )
        }
    }

    suspend fun fetchShazamKitToken(): Result<ShazamKitTokenResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url(buildUrl("/api/v1/shazamkit/token"))
                .applyAuralisHeaders()
                .get()
                .build()

            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val err = parseErrorEnvelope(body)
                    throw IOException(err?.error?.message ?: "ShazamKit token unavailable (HTTP ${resp.code})")
                }
                json.decodeFromString<ShazamKitTokenResponse>(body)
            }
        }
    }

    suspend fun register(email: String, password: String): Result<AuthSessionResponse> =
        authenticate("/api/v1/auth/register", email, password)

    suspend fun login(email: String, password: String): Result<AuthSessionResponse> =
        authenticate("/api/v1/auth/login", email, password)

    private suspend fun authenticate(
        path: String,
        email: String,
        password: String
    ): Result<AuthSessionResponse> = withContext(Dispatchers.IO) {
        runCatching {
            val payload = json.encodeToString(AuthCredentialsRequest(email = email.trim(), password = password))
            val req = Request.Builder()
                .url(buildUrl(path))
                .applyAuralisHeaders()
                .post(payload.toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val err = parseErrorEnvelope(body)
                    throw IOException(err?.error?.message ?: "Authentication failed (HTTP ${resp.code})")
                }
                json.decodeFromString<AuthSessionResponse>(body)
            }
        }
    }

    suspend fun syncLibrary(items: List<LibraryItem>, since: String? = null): Result<LibrarySyncResponse> =
        withContext(Dispatchers.IO) {
            runCatching {
                val payload = json.encodeToString(LibrarySyncRequest(items = items))
                val syncReq = Request.Builder()
                    .url(buildUrl("/api/v1/library/sync"))
                    .applyAuralisHeaders()
                    .post(payload.toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(syncReq).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful) {
                        val err = parseErrorEnvelope(body)
                        throw IOException(err?.error?.message ?: "Library sync failed (HTTP ${resp.code})")
                    }
                    val syncResponse = json.decodeFromString<LibrarySyncResponse>(body)
                    if (!since.isNullOrBlank()) {
                        val listUrl = buildUrl("/api/v1/library").toHttpUrlOrNull()
                            ?.newBuilder()
                            ?.addQueryParameter("since", since)
                            ?.build()
                        if (listUrl != null) {
                            val getReq = Request.Builder()
                                .url(listUrl)
                                .applyAuralisHeaders()
                                .get()
                                .build()
                            client.newCall(getReq).execute().use { getResp ->
                                if (getResp.isSuccessful) {
                                    val getBody = getResp.body?.string().orEmpty()
                                    val listResp = runCatching {
                                        json.decodeFromString<LibraryListResponse>(getBody)
                                    }.getOrNull()
                                    if (listResp != null && listResp.items.isNotEmpty()) {
                                        val merged = (syncResponse.items + listResp.items)
                                            .associateBy { it.id }
                                            .values
                                            .toList()
                                        return@use syncResponse.copy(items = merged)
                                    }
                                }
                            }
                        }
                    }
                    syncResponse
                }
            }
        }

    suspend fun clearRemoteLibrary(): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url(buildUrl("/api/v1/library"))
                .applyAuralisHeaders()
                .delete()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val err = parseErrorEnvelope(body)
                    throw IOException(err?.error?.message ?: "Could not clear remote library (HTTP ${resp.code})")
                }
            }
        }
    }

    suspend fun deleteAccount(): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val req = Request.Builder()
                .url(buildUrl("/api/v1/account"))
                .applyAuralisHeaders()
                .delete()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val body = resp.body?.string().orEmpty()
                    val err = parseErrorEnvelope(body)
                    throw IOException(err?.error?.message ?: "Could not delete account (HTTP ${resp.code})")
                }
            }
        }
    }

    private fun parseErrorEnvelope(bodyText: String): ApiErrorEnvelope? {
        if (bodyText.isBlank()) return null
        return runCatching {
            json.decodeFromString<ApiErrorEnvelope>(bodyText)
        }.getOrNull()
    }

    private fun defaultMessageForErrorCode(code: String, httpCode: Int): String = when (code) {
        "NOT_CONFIGURED" -> "Recognition provider is not configured on the server."
        "PROVIDER_AUTH" -> "Recognition provider authentication failed on the server."
        "PROVIDER_QUOTA" -> "Recognition provider quota has been exhausted."
        "PROVIDER_UNAVAILABLE" -> "Recognition provider is currently unavailable."
        "UNSUPPORTED_FORMAT" -> "Audio format was rejected by the server."
        "PAYLOAD_TOO_LARGE" -> "Recorded audio sample exceeded the 1 MB upload limit."
        "UNAUTHORIZED" -> "Session expired or unauthorized. Please sign in again."
        else -> "Recognition service is temporarily unavailable (HTTP $httpCode)."
    }
}
