package app.auralis.dsp

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Quality metrics computed on the captured mono signal per Auralis Contract.
 */
data class AudioQualityMetrics(
    val rmsDbfs: Double,
    val peak: Double,
    val clippingRatio: Double,
    val silenceRatio: Double
) {
    /**
     * Contract rule: If rmsDbfs < -50 OR silenceRatio > 0.85 -> state `too_quiet`, DO NOT upload.
     */
    val isTooQuiet: Boolean
        get() = rmsDbfs < -50.0 || silenceRatio > 0.85

    /**
     * Contract rule: If clippingRatio > 0.05 -> still upload, show distortion hint.
     */
    val isClipping: Boolean
        get() = clippingRatio > 0.05

    val tooQuietMessage: String
        get() = "Move closer to the music or turn it up"

    val clippingHint: String?
        get() = if (isClipping) {
            "Input is distorting — lower the volume or move back"
        } else {
            null
        }
}

/**
 * Real-time level meter frame (~20 Hz / 50 ms window) mapped from -60..0 dBFS to 0..1.
 */
data class LiveLevel(
    val rmsDbfs: Double,
    val normalizedRms: Float,
    val peak: Float
) {
    companion object {
        val SILENT = LiveLevel(rmsDbfs = -100.0, normalizedRms = 0f, peak = 0f)
    }
}

/**
 * Output of the full DSP preprocessing + quality gate pipeline.
 */
data class ProcessedAudio(
    val wavBytes: ByteArray,
    val samples16k: FloatArray,
    val durationMs: Long,
    val sampleRate: Int,
    val metrics: AudioQualityMetrics
)

/**
 * Pure-Kotlin DSP utilities for Auralis audio preprocessing, quality gating, and resampling.
 * Designed to have zero Android framework dependencies so it runs deterministically in JVM tests.
 */
object AudioDsp {

    private const val MIN_DBFS = -100.0
    private const val CLIPPING_THRESHOLD = 0.985f
    private const val SILENCE_WINDOW_SEC = 0.050 // 50 ms
    private const val SILENCE_THRESHOLD_DBFS = -55.0

    /**
     * Converts 16-bit signed PCM samples into normalized mono [-1.0, 1.0] floats.
     * Averages channels if [channels] > 1 (e.g., stereo -> mono average).
     */
    fun pcm16ToFloatMono(samples: ShortArray, channels: Int = 1, frameCount: Int = samples.size / max(1, channels)): FloatArray {
        if (samples.isEmpty() || channels <= 0 || frameCount <= 0) return FloatArray(0)
        val safeFrames = min(frameCount, samples.size / channels)
        val mono = FloatArray(safeFrames)
        if (channels == 1) {
            for (i in 0 until safeFrames) {
                mono[i] = (samples[i].toFloat() / 32768.0f).coerceIn(-1.0f, 1.0f)
            }
        } else {
            val invChannels = 1.0f / channels.toFloat()
            for (frame in 0 until safeFrames) {
                val baseIdx = frame * channels
                var sum = 0.0f
                for (ch in 0 until channels) {
                    sum += samples[baseIdx + ch].toFloat() / 32768.0f
                }
                mono[frame] = (sum * invChannels).coerceIn(-1.0f, 1.0f)
            }
        }
        return mono
    }

    /**
     * Converts normalized float mono samples [-1.0, 1.0] back to 16-bit signed PCM shorts.
     */
    fun floatToPcm16(samples: FloatArray): ShortArray {
        val out = ShortArray(samples.size)
        for (i in samples.indices) {
            val clamped = samples[i].coerceIn(-1.0f, 1.0f)
            val scaled = (clamped * 32767.0f).roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt())
            out[i] = scaled.toShort()
        }
        return out
    }

    /**
     * Removes DC offset by subtracting the mean signal value from each sample.
     */
    fun removeDcOffset(samples: FloatArray): FloatArray {
        if (samples.isEmpty()) return FloatArray(0)
        var sum = 0.0
        for (sample in samples) {
            sum += sample.toDouble()
        }
        val mean = (sum / samples.size.toDouble()).toFloat()
        if (abs(mean) < 1e-7f) return samples.copyOf()
        val out = FloatArray(samples.size)
        for (i in samples.indices) {
            out[i] = (samples[i] - mean).coerceIn(-1.0f, 1.0f)
        }
        return out
    }

    /**
     * Computes RMS in dBFS for a slice of normalized float samples.
     */
    fun computeRmsDbfs(samples: FloatArray, startIndex: Int = 0, endIndex: Int = samples.size): Double {
        val count = endIndex - startIndex
        if (count <= 0) return MIN_DBFS
        var sumSq = 0.0
        for (i in startIndex until endIndex) {
            val x = samples[i].toDouble()
            sumSq += x * x
        }
        val rms = sqrt(sumSq / count.toDouble())
        return linearToDbfs(rms)
    }

    /**
     * Computes live level meter from the most recent ~50 ms of 16-bit PCM samples.
     * Maps -60..0 dBFS -> 0..1 per contract.
     */
    fun computeLiveLevel(samples: ShortArray, count: Int = samples.size): LiveLevel {
        val safeCount = min(count, samples.size)
        if (safeCount <= 0) return LiveLevel.SILENT
        var sumSq = 0.0
        var maxAbs = 0.0f
        for (i in 0 until safeCount) {
            val normalized = abs(samples[i].toFloat() / 32768.0f).coerceIn(0.0f, 1.0f)
            sumSq += (normalized * normalized).toDouble()
            if (normalized > maxAbs) {
                maxAbs = normalized
            }
        }
        val rms = sqrt(sumSq / safeCount.toDouble())
        val dbfs = linearToDbfs(rms)
        val mapped = ((dbfs + 60.0) / 60.0).coerceIn(0.0, 1.0).toFloat()
        return LiveLevel(
            rmsDbfs = dbfs,
            normalizedRms = mapped,
            peak = maxAbs
        )
    }

    /**
     * Computes the pre-upload quality gate metrics on the mono signal:
     * - rmsDbfs overall
     * - peak
     * - clippingRatio = fraction of samples with |x| >= 0.985
     * - silenceRatio = fraction of 50 ms windows with RMS < -55 dBFS
     */
    fun computeQualityMetrics(monoSamples: FloatArray, sampleRate: Int): AudioQualityMetrics {
        if (monoSamples.isEmpty() || sampleRate <= 0) {
            return AudioQualityMetrics(
                rmsDbfs = MIN_DBFS,
                peak = 0.0,
                clippingRatio = 0.0,
                silenceRatio = 1.0
            )
        }

        var sumSq = 0.0
        var peak = 0.0
        var clippedCount = 0

        for (sample in monoSamples) {
            val absVal = abs(sample)
            val dVal = absVal.toDouble()
            sumSq += dVal * dVal
            if (dVal > peak) {
                peak = dVal
            }
            if (absVal >= CLIPPING_THRESHOLD) {
                clippedCount++
            }
        }

        val overallRms = sqrt(sumSq / monoSamples.size.toDouble())
        val rmsDbfs = linearToDbfs(overallRms)
        val clippingRatio = clippedCount.toDouble() / monoSamples.size.toDouble()

        val windowSamples = max(1, (sampleRate * SILENCE_WINDOW_SEC).roundToInt())
        var windowCount = 0
        var silentWindows = 0
        var offset = 0
        while (offset < monoSamples.size) {
            val end = min(monoSamples.size, offset + windowSamples)
            // Evaluate all full windows, or the single partial window if the entire clip is shorter than 50 ms
            if (end - offset == windowSamples || windowCount == 0) {
                val windowDbfs = computeRmsDbfs(monoSamples, offset, end)
                windowCount++
                if (windowDbfs < SILENCE_THRESHOLD_DBFS) {
                    silentWindows++
                }
            }
            offset += windowSamples
        }

        val silenceRatio = if (windowCount == 0) 1.0 else silentWindows.toDouble() / windowCount.toDouble()

        return AudioQualityMetrics(
            rmsDbfs = rmsDbfs,
            peak = peak,
            clippingRatio = clippingRatio,
            silenceRatio = silenceRatio
        )
    }

    /**
     * Gentle peak normalization to -1 dBFS ONLY if peak < 0.5 (and signal is non-silent).
     * Per contract: "gentle peak normalisation to −1 dBFS only if peak < 0.5. No noise suppression."
     */
    fun normalizePeakGently(
        samples: FloatArray,
        targetPeakDbfs: Double = -1.0,
        thresholdPeak: Double = 0.5
    ): FloatArray {
        if (samples.isEmpty()) return FloatArray(0)
        var peak = 0.0f
        for (s in samples) {
            val a = abs(s)
            if (a > peak) peak = a
        }
        if (peak <= 1e-5f || peak >= thresholdPeak.toFloat()) {
            return samples.copyOf()
        }
        val targetLinear = 10.0.pow(targetPeakDbfs / 20.0).toFloat() // ~0.89125f for -1 dBFS
        val gain = targetLinear / peak
        val out = FloatArray(samples.size)
        for (i in samples.indices) {
            out[i] = (samples[i] * gain).coerceIn(-1.0f, 1.0f)
        }
        return out
    }

    /**
     * Anti-aliased windowed-sinc (Blackman window) resampler to convert arbitrary sample rates
     * (e.g., 48 000 Hz or 44 100 Hz) to 16 000 Hz mono.
     */
    fun resampleWindowedSinc(
        input: FloatArray,
        fromRate: Int,
        toRate: Int = 16000,
        halfWindowZeros: Int = 16
    ): FloatArray {
        require(fromRate > 0 && toRate > 0) { "Sample rates must be positive" }
        if (input.isEmpty()) return FloatArray(0)
        if (fromRate == toRate) return input.copyOf()

        val ratio = toRate.toDouble() / fromRate.toDouble()
        val outputLength = max(1, (input.size.toDouble() * ratio).roundToInt())
        val output = FloatArray(outputLength)

        // Anti-aliasing low-pass cutoff relative to input Nyquist when downsampling
        val cutoff = min(1.0, ratio)
        val filterScale = cutoff
        val halfWidth = halfWindowZeros.toDouble() / cutoff
        val radius = floor(halfWidth).toInt().coerceAtLeast(1)

        for (outIdx in 0 until outputLength) {
            val centerIn = outIdx.toDouble() / ratio
            val centerInt = floor(centerIn).toInt()
            val startIn = max(0, centerInt - radius)
            val endIn = min(input.size - 1, centerInt + radius)

            var acc = 0.0
            var weightSum = 0.0
            for (inIdx in startIn..endIn) {
                val delta = inIdx.toDouble() - centerIn
                val x = delta * filterScale
                if (abs(x) <= halfWindowZeros.toDouble()) {
                    val sincVal = sinc(x)
                    // Blackman window over [-halfWindowZeros, +halfWindowZeros]
                    val normPos = (x / halfWindowZeros.toDouble() + 1.0) * 0.5
                    val window = 0.42 - 0.5 * cos(2.0 * PI * normPos) + 0.08 * cos(4.0 * PI * normPos)
                    val w = sincVal * window * filterScale
                    acc += input[inIdx].toDouble() * w
                    weightSum += w
                }
            }
            val sample = if (abs(weightSum) > 1e-9) acc / weightSum else 0.0
            output[outIdx] = sample.toFloat().coerceIn(-1.0f, 1.0f)
        }

        return output
    }

    /**
     * Full contract pipeline:
     * 1. Stereo/multi-channel PCM16 -> mono FloatArray
     * 2. DC-offset removal
     * 3. Pre-upload quality gate calculation (rmsDbfs, peak, clippingRatio, silenceRatio)
     * 4. Anti-aliased windowed-sinc resample to 16 000 Hz
     * 5. Gentle peak normalization to -1 dBFS if peak < 0.5
     * 6. Encode to 16-bit mono 16 kHz WAV
     */
    fun preprocessAndGate(
        pcmSamples: ShortArray,
        sampleRate: Int,
        channels: Int = 1,
        targetSampleRate: Int = 16000
    ): ProcessedAudio {
        val monoRaw = pcm16ToFloatMono(pcmSamples, channels)
        val dcRemoved = removeDcOffset(monoRaw)
        val metrics = computeQualityMetrics(dcRemoved, sampleRate)

        val resampled = resampleWindowedSinc(
            input = dcRemoved,
            fromRate = sampleRate,
            toRate = targetSampleRate
        )
        val normalized = if (!metrics.isTooQuiet) {
            normalizePeakGently(resampled, targetPeakDbfs = -1.0, thresholdPeak = 0.5)
        } else {
            resampled
        }

        val wavBytes = WavEncoder.encodePcm16MonoWav(normalized, targetSampleRate)
        val durationMs = if (targetSampleRate > 0) {
            (normalized.size * 1000L) / targetSampleRate.toLong()
        } else {
            0L
        }

        return ProcessedAudio(
            wavBytes = wavBytes,
            samples16k = normalized,
            durationMs = durationMs,
            sampleRate = targetSampleRate,
            metrics = metrics
        )
    }

    private fun sinc(x: Double): Double {
        if (abs(x) < 1e-9) return 1.0
        val pix = PI * x
        return sin(pix) / pix
    }

    private fun linearToDbfs(linear: Double): Double {
        if (linear <= 1e-5) return MIN_DBFS
        return max(MIN_DBFS, 20.0 * log10(linear))
    }
}
