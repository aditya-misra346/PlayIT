package app.auralis.dsp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

class AudioDspTest {

    @Test
    fun `synthetic silence triggers too_quiet quality gate`() {
        val sampleRate = 16000
        val silentSamples = FloatArray(sampleRate * 5) { 0f }

        val metrics = AudioDsp.computeQualityMetrics(silentSamples, sampleRate)

        assertTrue("Expected rmsDbfs < -50, got ${metrics.rmsDbfs}", metrics.rmsDbfs < -50.0)
        assertEquals(0.0, metrics.peak, 1e-6)
        assertEquals(0.0, metrics.clippingRatio, 1e-6)
        assertEquals(1.0, metrics.silenceRatio, 1e-6)
        assertTrue(metrics.isTooQuiet)
        assertFalse(metrics.isClipping)
        assertEquals("Move closer to the music or turn it up", metrics.tooQuietMessage)
        assertNull(metrics.clippingHint)
    }

    @Test
    fun `mostly silent signal with brief blip triggers silenceRatio gate`() {
        val sampleRate = 16000
        // 10 seconds = 200 windows of 50 ms. Make only 10 windows (5%) loud, 95% silent.
        val totalSamples = sampleRate * 10
        val samples = FloatArray(totalSamples)
        val loudSamples = (sampleRate * 0.5).toInt() // 0.5s out of 10s
        for (i in 0 until loudSamples) {
            samples[i] = 0.6f * sin(2.0 * PI * 440.0 * i / sampleRate).toFloat()
        }

        val metrics = AudioDsp.computeQualityMetrics(samples, sampleRate)
        assertTrue("Expected silenceRatio > 0.85, got ${metrics.silenceRatio}", metrics.silenceRatio > 0.85)
        assertTrue("Expected isTooQuiet when silenceRatio > 0.85", metrics.isTooQuiet)
    }

    @Test
    fun `clean synthetic sine wave passes quality gate without clipping`() {
        val sampleRate = 16000
        val durationSec = 4
        val amplitude = 0.7f
        val samples = FloatArray(sampleRate * durationSec) { i ->
            (amplitude * sin(2.0 * PI * 440.0 * i / sampleRate)).toFloat()
        }

        val metrics = AudioDsp.computeQualityMetrics(samples, sampleRate)

        // RMS of sine wave with amplitude 0.7 is 0.7 / sqrt(2) ≈ 0.495 -> ~ -6.1 dBFS
        assertEquals(-6.1, metrics.rmsDbfs, 0.25)
        assertEquals(0.7, metrics.peak, 0.01)
        assertEquals(0.0, metrics.clippingRatio, 1e-6)
        assertEquals(0.0, metrics.silenceRatio, 1e-6)
        assertFalse(metrics.isTooQuiet)
        assertFalse(metrics.isClipping)
        assertNull(metrics.clippingHint)
    }

    @Test
    fun `heavily clipped synthetic wave flags clipping hint but still allows upload`() {
        val sampleRate = 16000
        val samples = FloatArray(sampleRate * 2) { i ->
            // Overdriven sine clamped at +/- 1.0 so a large fraction of samples >= 0.985
            val raw = 2.0 * sin(2.0 * PI * 440.0 * i / sampleRate)
            raw.coerceIn(-1.0, 1.0).toFloat()
        }

        val metrics = AudioDsp.computeQualityMetrics(samples, sampleRate)

        assertTrue("Expected clippingRatio > 0.05, got ${metrics.clippingRatio}", metrics.clippingRatio > 0.05)
        assertTrue(metrics.isClipping)
        assertFalse("Clipped signal should still be uploaded (not too_quiet)", metrics.isTooQuiet)
        assertEquals(
            "Input is distorting — lower the volume or move back",
            metrics.clippingHint
        )
    }

    @Test
    fun `removeDcOffset eliminates constant DC bias`() {
        val sampleRate = 16000
        val dcBias = 0.32f
        val biased = FloatArray(sampleRate) { i ->
            dcBias + 0.25f * sin(2.0 * PI * 250.0 * i / sampleRate).toFloat()
        }

        val cleaned = AudioDsp.removeDcOffset(biased)
        val meanAfter = cleaned.map { it.toDouble() }.average()

        assertEquals(0.0, meanAfter, 1e-4)
    }

    @Test
    fun `stereo PCM16 converts to mono average accurately`() {
        // Frame 0: L = +16384 (~0.5), R = 0 -> Mono ~0.25
        // Frame 1: L = +16384 (~0.5), R = +16384 (~0.5) -> Mono ~0.5
        val stereoPcm = shortArrayOf(16384, 0, 16384, 16384)
        val mono = AudioDsp.pcm16ToFloatMono(stereoPcm, channels = 2)

        assertEquals(2, mono.size)
        assertEquals(0.25f, mono[0], 0.001f)
        assertEquals(0.50f, mono[1], 0.001f)
    }

    @Test
    fun `gentle peak normalization scales signals with peak below 0_5 to minus 1 dBFS and leaves louder signals intact`() {
        val quietTone = FloatArray(4000) { i ->
            0.20f * sin(2.0 * PI * 440.0 * i / 16000.0).toFloat()
        }
        val normalizedQuiet = AudioDsp.normalizePeakGently(quietTone)
        val newPeak = normalizedQuiet.maxOf { abs(it) }
        // -1 dBFS is 10^(-1/20) ≈ 0.89125
        assertEquals(0.891f, newPeak, 0.01f)

        val loudTone = FloatArray(4000) { i ->
            0.65f * sin(2.0 * PI * 440.0 * i / 16000.0).toFloat()
        }
        val untouchedLoud = AudioDsp.normalizePeakGently(loudTone)
        val loudPeak = untouchedLoud.maxOf { abs(it) }
        assertEquals(0.65f, loudPeak, 0.005f)
    }

    @Test
    fun `windowed sinc resampler converts 48kHz to 16kHz preserving passband and attenuating above Nyquist`() {
        val fromRate = 48000
        val toRate = 16000

        // 1. Passband tone: 1000 Hz at 48 kHz for 0.5 seconds (24,000 samples)
        val passband48k = FloatArray(fromRate / 2) { i ->
            0.8f * sin(2.0 * PI * 1000.0 * i / fromRate).toFloat()
        }
        val resampledPassband = AudioDsp.resampleWindowedSinc(passband48k, fromRate = fromRate, toRate = toRate)
        assertEquals(toRate / 2, resampledPassband.size)

        // Trim edge filter transients and verify RMS energy is preserved
        val innerSlice = resampledPassband.sliceArray(200 until resampledPassband.size - 200)
        val rmsPassband = sqrt(innerSlice.map { (it * it).toDouble() }.average())
        val expectedRms = 0.8 / sqrt(2.0) // ~0.565
        assertEquals(expectedRms, rmsPassband, 0.04)

        // 2. Stopband tone: 14,000 Hz (above 8,000 Hz Nyquist of 16 kHz output)
        val stopband48k = FloatArray(fromRate / 2) { i ->
            0.8f * sin(2.0 * PI * 14000.0 * i / fromRate).toFloat()
        }
        val resampledStopband = AudioDsp.resampleWindowedSinc(stopband48k, fromRate = fromRate, toRate = toRate)
        val innerStop = resampledStopband.sliceArray(200 until resampledStopband.size - 200)
        val rmsStopband = sqrt(innerStop.map { (it * it).toDouble() }.average())
        assertTrue("Expected strong anti-aliasing attenuation above 8kHz, got RMS $rmsStopband", rmsStopband < 0.05)
    }

    @Test
    fun `WavEncoder produces valid 16-bit mono 16kHz RIFF WAVE payload`() {
        val sampleRate = 16000
        val tenSecSamples = FloatArray(sampleRate * 10) { i ->
            (0.5 * sin(2.0 * PI * 440.0 * i / sampleRate)).toFloat()
        }

        val wavBytes = WavEncoder.encodePcm16MonoWav(tenSecSamples, sampleRate)
        // 10s * 16000 * 2 bytes + 44 header = 320,044 bytes (~320 KB per contract)
        assertEquals(320_044, wavBytes.size)

        val header = WavEncoder.parseWavHeader(wavBytes)
        assertEquals(1, header.audioFormat)
        assertEquals(1, header.numChannels)
        assertEquals(16000, header.sampleRate)
        assertEquals(32000, header.byteRate)
        assertEquals(2, header.blockAlign)
        assertEquals(16, header.bitsPerSample)
        assertEquals(320_000, header.dataSizeBytes)
        assertEquals(160_000, header.sampleCount)
    }

    @Test
    fun `preprocessAndGate runs full pipeline from 48kHz PCM16 to 16kHz WAV`() {
        val inputRate = 48000
        val pcm48k = ShortArray(inputRate * 2) { i ->
            val v = 0.35 * sin(2.0 * PI * 520.0 * i / inputRate)
            (v * 32767.0).roundToInt().toShort()
        }

        val processed = AudioDsp.preprocessAndGate(
            pcmSamples = pcm48k,
            sampleRate = inputRate,
            channels = 1,
            targetSampleRate = 16000
        )

        assertEquals(16000, processed.sampleRate)
        assertEquals(2000L, processed.durationMs)
        assertFalse(processed.metrics.isTooQuiet)
        assertFalse(processed.metrics.isClipping)
        val header = WavEncoder.parseWavHeader(processed.wavBytes)
        assertNotNull(header)
        assertEquals(16000, header.sampleRate)
        assertEquals(32000, header.sampleCount)
    }
}
