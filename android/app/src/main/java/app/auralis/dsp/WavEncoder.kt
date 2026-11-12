package app.auralis.dsp

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.roundToInt

/**
 * Parsed metadata from a RIFF/WAVE header for verification and unit tests.
 */
data class WavHeader(
    val audioFormat: Int,
    val numChannels: Int,
    val sampleRate: Int,
    val byteRate: Int,
    val blockAlign: Int,
    val bitsPerSample: Int,
    val dataSizeBytes: Int
) {
    val sampleCount: Int
        get() = if (blockAlign > 0) dataSizeBytes / blockAlign else 0
}

/**
 * Encodes normalized mono float or 16-bit PCM samples into a standard 44-byte RIFF/WAVE
 * PCM 16-bit mono little-endian byte array.
 */
object WavEncoder {

    const val HEADER_SIZE_BYTES = 44

    fun encodePcm16MonoWav(samples: FloatArray, sampleRate: Int = 16000): ByteArray {
        val pcmShorts = AudioDsp.floatToPcm16(samples)
        return encodePcm16MonoWavFromShorts(pcmShorts, sampleRate)
    }

    fun encodePcm16MonoWavFromShorts(samples: ShortArray, sampleRate: Int = 16000): ByteArray {
        val numChannels = 1
        val bitsPerSample = 16
        val bytesPerSample = bitsPerSample / 8
        val dataSize = samples.size * numChannels * bytesPerSample
        val byteRate = sampleRate * numChannels * bytesPerSample
        val blockAlign = numChannels * bytesPerSample
        val totalChunkSize = 36 + dataSize

        val buffer = ByteBuffer.allocate(HEADER_SIZE_BYTES + dataSize).order(ByteOrder.LITTLE_ENDIAN)

        // RIFF chunk descriptor
        buffer.put('R'.code.toByte())
        buffer.put('I'.code.toByte())
        buffer.put('F'.code.toByte())
        buffer.put('F'.code.toByte())
        buffer.putInt(totalChunkSize)
        buffer.put('W'.code.toByte())
        buffer.put('A'.code.toByte())
        buffer.put('V'.code.toByte())
        buffer.put('E'.code.toByte())

        // "fmt " sub-chunk
        buffer.put('f'.code.toByte())
        buffer.put('m'.code.toByte())
        buffer.put('t'.code.toByte())
        buffer.put(' '.code.toByte())
        buffer.putInt(16) // Subchunk1Size for PCM
        buffer.putShort(1.toShort()) // AudioFormat = 1 (PCM)
        buffer.putShort(numChannels.toShort())
        buffer.putInt(sampleRate)
        buffer.putInt(byteRate)
        buffer.putShort(blockAlign.toShort())
        buffer.putShort(bitsPerSample.toShort())

        // "data" sub-chunk
        buffer.put('d'.code.toByte())
        buffer.put('a'.code.toByte())
        buffer.put('t'.code.toByte())
        buffer.put('a'.code.toByte())
        buffer.putInt(dataSize)

        for (sample in samples) {
            buffer.putShort(sample)
        }

        return buffer.array()
    }

    fun parseWavHeader(wavBytes: ByteArray): WavHeader {
        require(wavBytes.size >= HEADER_SIZE_BYTES) {
            "WAV byte array too short (${wavBytes.size} bytes)"
        }
        val buf = ByteBuffer.wrap(wavBytes).order(ByteOrder.LITTLE_ENDIAN)
        val riff = ByteArray(4).also { buf.get(it) }.decodeToString()
        require(riff == "RIFF") { "Invalid RIFF header: $riff" }
        buf.int // chunkSize
        val wave = ByteArray(4).also { buf.get(it) }.decodeToString()
        require(wave == "WAVE") { "Invalid WAVE magic: $wave" }
        val fmt = ByteArray(4).also { buf.get(it) }.decodeToString()
        require(fmt == "fmt ") { "Invalid fmt chunk: $fmt" }
        val subchunk1Size = buf.int
        require(subchunk1Size == 16) { "Expected PCM fmt size 16, got $subchunk1Size" }
        val audioFormat = buf.short.toInt() and 0xFFFF
        val numChannels = buf.short.toInt() and 0xFFFF
        val sampleRate = buf.int
        val byteRate = buf.int
        val blockAlign = buf.short.toInt() and 0xFFFF
        val bitsPerSample = buf.short.toInt() and 0xFFFF
        val dataTag = ByteArray(4).also { buf.get(it) }.decodeToString()
        require(dataTag == "data") { "Invalid data chunk tag: $dataTag" }
        val dataSize = buf.int

        return WavHeader(
            audioFormat = audioFormat,
            numChannels = numChannels,
            sampleRate = sampleRate,
            byteRate = byteRate,
            blockAlign = blockAlign,
            bitsPerSample = bitsPerSample,
            dataSizeBytes = dataSize
        )
    }
}
