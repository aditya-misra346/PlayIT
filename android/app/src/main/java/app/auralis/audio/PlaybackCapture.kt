package app.auralis.audio

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.os.Build
import android.os.SystemClock
import androidx.annotation.RequiresApi
import app.auralis.dsp.AudioDsp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

/**
 * Android 10+ (API 29+) internal audio playback capture adapter using [AudioPlaybackCaptureConfiguration]
 * and a user-consented [android.media.projection.MediaProjection] session hosted in [PlaybackCaptureService].
 *
 * Honesty & fallback rules:
 * - Configures USAGE_MEDIA, USAGE_GAME, and USAGE_UNKNOWN.
 * - Because Android apps can opt out of playback capture (`android:allowAudioPlaybackCapture="false"` or
 *   `ALLOW_CAPTURE_BY_NONE`, common in DRM or some streaming apps), if the captured playback signal is
 *   completely silent, this adapter returns [AudioCaptureResult.SilentPlaybackFallbackSuggested] so the
 *   UI explains why and offers an immediate switch to Microphone mode.
 */
class PlaybackCapture(context: Context) {

    private val appContext = context.applicationContext

    val isSupported: Boolean
        get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    @SuppressLint("MissingPermission")
    suspend fun recordFromPlayback(
        resultCode: Int,
        resultData: Intent,
        targetSeconds: Int = 10,
        listener: AudioCaptureProgressListener? = null
    ): AudioCaptureResult = withContext(Dispatchers.IO) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return@withContext AudioCaptureResult.Error(
                "Device audio playback capture requires Android 10 (API 29) or newer."
            )
        }

        val clampedSeconds = targetSeconds.coerceIn(4, 12)
        val targetDurationMs = clampedSeconds * 1000L

        val projection = try {
            PlaybackCaptureService.startAndAwaitProjection(appContext, resultCode, resultData)
        } catch (t: Throwable) {
            PlaybackCaptureService.stopServiceAndRelease(appContext)
            return@withContext AudioCaptureResult.Error(
                "Could not start device audio projection: ${t.message ?: "permission denied"}"
            )
        }

        var audioRecord: AudioRecord? = null
        try {
            val opened = buildPlaybackAudioRecord(projection)
                ?: return@withContext AudioCaptureResult.Error(
                    "Unable to initialize AudioPlaybackCapture on this device."
                )

            audioRecord = opened.first
            val sampleRate = opened.second

            audioRecord.startRecording()
            if (audioRecord.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                return@withContext AudioCaptureResult.Error(
                    "Device audio playback capture failed to start recording."
                )
            }

            val totalSamplesTarget = sampleRate * clampedSeconds
            val captured = ShortArray(totalSamplesTarget)
            var capturedCount = 0

            val chunkSamples = max(256, sampleRate / 20)
            val chunkBuffer = ShortArray(chunkSamples)
            val startElapsed = SystemClock.elapsedRealtime()

            var nonSilentChunks = 0
            var totalChunks = 0

            while (capturedCount < totalSamplesTarget) {
                currentCoroutineContext().ensureActive()

                val toRead = min(chunkSamples, totalSamplesTarget - capturedCount)
                val read = audioRecord.read(chunkBuffer, 0, toRead)
                if (read < 0) {
                    return@withContext AudioCaptureResult.Error("Playback capture read error ($read).")
                }
                if (read > 0) {
                    System.arraycopy(chunkBuffer, 0, captured, capturedCount, read)
                    capturedCount += read
                    totalChunks++

                    val level = AudioDsp.computeLiveLevel(chunkBuffer, read)
                    if (level.rmsDbfs > -62.0) {
                        nonSilentChunks++
                    }
                    val elapsedMs = SystemClock.elapsedRealtime() - startElapsed
                    listener?.onLevelUpdate(level, elapsedMs, targetDurationMs)

                    // Early silent opt-out detection after ~3.5 seconds of complete digital silence:
                    if (elapsedMs >= 3500L && nonSilentChunks == 0 && totalChunks >= 20) {
                        return@withContext AudioCaptureResult.SilentPlaybackFallbackSuggested(
                            "The playing app appears to block internal audio capture (allowAudioPlaybackCapture=false). Switch to Microphone mode to identify it through your speakers."
                        )
                    }
                }

                val elapsedMs = SystemClock.elapsedRealtime() - startElapsed
                if (elapsedMs >= targetDurationMs) {
                    break
                }
            }

            val finalSamples = if (capturedCount == captured.size) {
                captured
            } else {
                captured.copyOf(capturedCount)
            }

            if (finalSamples.isEmpty() || nonSilentChunks == 0) {
                return@withContext AudioCaptureResult.SilentPlaybackFallbackSuggested(
                    "Captured device audio was silent. Many music apps opt out of playback capture (ALLOW_CAPTURE_BY_NONE). Switch to Microphone mode to listen via speaker."
                )
            }

            val durationMs = (finalSamples.size * 1000L) / sampleRate.toLong()
            AudioCaptureResult.Completed(
                pcmSamples = finalSamples,
                sampleRate = sampleRate,
                channels = 1,
                source = AudioCaptureMode.PLAYBACK.wireSource,
                durationMs = durationMs
            )
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            AudioCaptureResult.Error("Playback capture error: ${t.message ?: t::class.simpleName}")
        } finally {
            runCatching {
                if (audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop()
                }
            }
            runCatching { audioRecord?.release() }
            PlaybackCaptureService.stopServiceAndRelease(appContext)
        }
    }

    @RequiresApi(Build.VERSION_CODES.Q)
    @SuppressLint("MissingPermission")
    private fun buildPlaybackAudioRecord(
        projection: android.media.projection.MediaProjection
    ): Pair<AudioRecord, Int>? {
        val captureConfig = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()

        for (rate in intArrayOf(16000, 48000, 44100)) {
            val minBuf = AudioRecord.getMinBufferSize(
                rate,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuf <= 0) continue
            val bufSize = max(minBuf * 2, rate * 2 / 5)
            try {
                val format = AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build()
                val record = AudioRecord.Builder()
                    .setAudioPlaybackCaptureConfig(captureConfig)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufSize)
                    .build()
                if (record.state == AudioRecord.STATE_INITIALIZED) {
                    return record to rate
                } else {
                    record.release()
                }
            } catch (_: Throwable) {
                // Try next sample rate
            }
        }
        return null
    }
}
