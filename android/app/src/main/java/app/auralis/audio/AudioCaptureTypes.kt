package app.auralis.audio

import app.auralis.dsp.LiveLevel

enum class AudioCaptureMode(val wireSource: String, val displayName: String) {
    MICROPHONE(wireSource = "microphone", displayName = "Microphone"),
    PLAYBACK(wireSource = "system", displayName = "Device Audio (Playback Capture)")
}

data class AudioInputDevice(
    val id: Int,
    val name: String,
    val typeLabel: String,
    val isDefault: Boolean = false,
    val isBluetoothSco: Boolean = false
)

sealed class AudioCaptureResult {
    data class Completed(
        val pcmSamples: ShortArray,
        val sampleRate: Int,
        val channels: Int,
        val source: String,
        val durationMs: Long
    ) : AudioCaptureResult()

    data object Cancelled : AudioCaptureResult()

    data class DeviceLost(val message: String) : AudioCaptureResult()

    data class MicUnavailable(val message: String) : AudioCaptureResult()

    data class SilentPlaybackFallbackSuggested(
        val message: String
    ) : AudioCaptureResult()

    data class Error(val message: String) : AudioCaptureResult()
}

interface AudioCaptureProgressListener {
    fun onLevelUpdate(level: LiveLevel, elapsedMs: Long, targetMs: Long)
}
