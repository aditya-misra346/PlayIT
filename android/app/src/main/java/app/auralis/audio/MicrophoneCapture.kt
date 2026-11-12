package app.auralis.audio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.AutomaticGainControl
import android.media.audiofx.NoiseSuppressor
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import app.auralis.dsp.AudioDsp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.min

/**
 * Captures raw music audio from an Android microphone using [AudioRecord].
 *
 * Contract compliance:
 * - Uses [MediaRecorder.AudioSource.UNPROCESSED] if supported, else [MediaRecorder.AudioSource.MIC].
 * - Explicitly disables voice processing (AGC, NS, AEC) if attached by OEM.
 * - Supports 16 kHz mono 16-bit PCM primary, or 48 kHz / 44.1 kHz mono 16-bit PCM fallback.
 * - Supports preferred input device selection via [AudioManager.getDevices] + [AudioRecord.setPreferredDevice],
 *   including USB, wired headset, and Bluetooth SCO.
 * - Detects active input device disconnection via [AudioDeviceCallback].
 */
class MicrophoneCapture(context: Context) {

    private val appContext = context.applicationContext
    private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    /**
     * Lists available audio input devices connected to the device.
     */
    fun listInputDevices(): List<AudioInputDevice> {
        val rawDevices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.isSource && isSupportedInputType(it.type) }

        val mapped = mutableListOf<AudioInputDevice>()
        var defaultAssigned = false
        for (info in rawDevices) {
            val typeLabel = deviceTypeLabel(info.type)
            val productName = info.productName?.toString()?.trim().orEmpty()
            val displayName = if (productName.isNotEmpty() && !productName.equals(Build.MODEL, ignoreCase = true)) {
                "$typeLabel ($productName)"
            } else {
                typeLabel
            }
            val isBuiltinDefault = !defaultAssigned && info.type == AudioDeviceInfo.TYPE_BUILTIN_MIC
            if (isBuiltinDefault) defaultAssigned = true
            mapped.add(
                AudioInputDevice(
                    id = info.id,
                    name = displayName,
                    typeLabel = typeLabel,
                    isDefault = isBuiltinDefault,
                    isBluetoothSco = info.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                )
            )
        }
        if (mapped.isNotEmpty() && mapped.none { it.isDefault }) {
            mapped[0] = mapped[0].copy(isDefault = true)
        }
        return mapped
    }

    @SuppressLint("MissingPermission")
    suspend fun record(
        targetSeconds: Int = 10,
        preferredDeviceId: Int? = null,
        listener: AudioCaptureProgressListener? = null
    ): AudioCaptureResult = withContext(Dispatchers.IO) {
        val clampedSeconds = targetSeconds.coerceIn(4, 12)
        val targetDurationMs = clampedSeconds * 1000L

        val availableDevices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.isSource && isSupportedInputType(it.type) }

        if (availableDevices.isEmpty()) {
            return@withContext AudioCaptureResult.MicUnavailable(
                "No microphone input device was found on this device."
            )
        }

        val selectedDeviceInfo: AudioDeviceInfo? = preferredDeviceId?.let { id ->
            availableDevices.firstOrNull { it.id == id }
        }

        val recordSpec = openBestAudioRecord()
            ?: return@withContext AudioCaptureResult.MicUnavailable(
                "Unable to initialize AudioRecord. Another app may be holding the microphone."
            )

        val audioRecord = recordSpec.audioRecord
        val sampleRate = recordSpec.sampleRate
        val deviceLostFlag = AtomicBoolean(false)
        var scoStarted = false

        val deviceCallback = object : AudioDeviceCallback() {
            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) {
                if (removedDevices.isNullOrEmpty()) return
                val activeDevice = audioRecord.routedDevice ?: selectedDeviceInfo
                val lost = removedDevices.any { removed ->
                    (selectedDeviceIdMatches(removed.id, preferredDeviceId)) ||
                        (activeDevice != null && removed.id == activeDevice.id)
                }
                if (lost) {
                    deviceLostFlag.set(true)
                }
            }
        }

        val mainHandler = Handler(Looper.getMainLooper())
        audioManager.registerAudioDeviceCallback(deviceCallback, mainHandler)

        try {
            disableVoiceProcessingEffects(audioRecord.audioSessionId)

            if (selectedDeviceInfo != null) {
                if (selectedDeviceInfo.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                    runCatching {
                        @Suppress("DEPRECATION")
                        audioManager.startBluetoothSco()
                        @Suppress("DEPRECATION")
                        audioManager.isBluetoothScoOn = true
                        scoStarted = true
                    }
                }
                audioRecord.setPreferredDevice(selectedDeviceInfo)
            }

            try {
                audioRecord.startRecording()
            } catch (se: SecurityException) {
                return@withContext AudioCaptureResult.MicUnavailable(
                    "Microphone permission was denied."
                )
            } catch (ise: IllegalStateException) {
                return@withContext AudioCaptureResult.MicUnavailable(
                    "Microphone could not start recording (${ise.message ?: "in use"})."
                )
            }

            if (audioRecord.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
                return@withContext AudioCaptureResult.MicUnavailable(
                    "Microphone is unavailable or in use by another application."
                )
            }

            val totalSamplesTarget = sampleRate * clampedSeconds
            val captured = ShortArray(totalSamplesTarget)
            var capturedCount = 0

            // Read in ~50 ms chunks so live level updates arrive ~20x/sec
            val chunkSamples = max(256, sampleRate / 20)
            val chunkBuffer = ShortArray(chunkSamples)
            val startElapsed = SystemClock.elapsedRealtime()

            while (capturedCount < totalSamplesTarget) {
                currentCoroutineContext().ensureActive()

                if (deviceLostFlag.get()) {
                    return@withContext AudioCaptureResult.DeviceLost(
                        "The selected microphone was disconnected during capture."
                    )
                }

                val toRead = min(chunkSamples, totalSamplesTarget - capturedCount)
                val read = audioRecord.read(chunkBuffer, 0, toRead)
                if (read < 0) {
                    return@withContext if (deviceLostFlag.get()) {
                        AudioCaptureResult.DeviceLost("Microphone disconnected during capture.")
                    } else {
                        AudioCaptureResult.MicUnavailable("AudioRecord read error ($read).")
                    }
                }
                if (read > 0) {
                    System.arraycopy(chunkBuffer, 0, captured, capturedCount, read)
                    capturedCount += read

                    val level = AudioDsp.computeLiveLevel(chunkBuffer, read)
                    val elapsedMs = SystemClock.elapsedRealtime() - startElapsed
                    listener?.onLevelUpdate(level, elapsedMs, targetDurationMs)
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
            val durationMs = if (sampleRate > 0) {
                (finalSamples.size * 1000L) / sampleRate.toLong()
            } else {
                0L
            }

            if (finalSamples.isEmpty()) {
                return@withContext AudioCaptureResult.MicUnavailable(
                    "No audio frames were received from the microphone."
                )
            }

            AudioCaptureResult.Completed(
                pcmSamples = finalSamples,
                sampleRate = sampleRate,
                channels = 1,
                source = AudioCaptureMode.MICROPHONE.wireSource,
                durationMs = durationMs
            )
        } catch (ce: CancellationException) {
            throw ce
        } catch (t: Throwable) {
            AudioCaptureResult.Error("Microphone capture error: ${t.message ?: t::class.simpleName}")
        } finally {
            audioManager.unregisterAudioDeviceCallback(deviceCallback)
            if (scoStarted) {
                runCatching {
                    @Suppress("DEPRECATION")
                    audioManager.isBluetoothScoOn = false
                    @Suppress("DEPRECATION")
                    audioManager.stopBluetoothSco()
                }
            }
            runCatching {
                if (audioRecord.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop()
                }
            }
            runCatching { audioRecord.release() }
        }
    }

    private fun selectedDeviceIdMatches(removedId: Int, preferredId: Int?): Boolean {
        return preferredId != null && removedId == preferredId
    }

    private data class OpenedRecord(
        val audioRecord: AudioRecord,
        val sampleRate: Int,
        val audioSource: Int
    )

    @SuppressLint("MissingPermission")
    private fun openBestAudioRecord(): OpenedRecord? {
        val supportsUnprocessed =
            audioManager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED)
                ?.equals("true", ignoreCase = true) == true

        val candidateSources = if (supportsUnprocessed) {
            intArrayOf(MediaRecorder.AudioSource.UNPROCESSED, MediaRecorder.AudioSource.MIC)
        } else {
            intArrayOf(MediaRecorder.AudioSource.MIC)
        }
        val candidateRates = intArrayOf(16000, 48000, 44100)

        for (source in candidateSources) {
            for (rate in candidateRates) {
                val minBuf = AudioRecord.getMinBufferSize(
                    rate,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT
                )
                if (minBuf <= 0) continue
                val bufferSizeInBytes = max(minBuf * 2, rate * 2 / 5) // at least ~200 ms buffer
                try {
                    val record = AudioRecord(
                        source,
                        rate,
                        AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT,
                        bufferSizeInBytes
                    )
                    if (record.state == AudioRecord.STATE_INITIALIZED) {
                        return OpenedRecord(record, rate, source)
                    } else {
                        record.release()
                    }
                } catch (_: Throwable) {
                    // Try next combination
                }
            }
        }
        return null
    }

    private fun disableVoiceProcessingEffects(audioSessionId: Int) {
        if (audioSessionId <= 0) return
        runCatching {
            if (AutomaticGainControl.isAvailable()) {
                AutomaticGainControl.create(audioSessionId)?.apply {
                    enabled = false
                    release()
                }
            }
        }
        runCatching {
            if (NoiseSuppressor.isAvailable()) {
                NoiseSuppressor.create(audioSessionId)?.apply {
                    enabled = false
                    release()
                }
            }
        }
        runCatching {
            if (AcousticEchoCanceler.isAvailable()) {
                AcousticEchoCanceler.create(audioSessionId)?.apply {
                    enabled = false
                    release()
                }
            }
        }
    }

    private fun isSupportedInputType(type: Int): Boolean {
        return when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC,
            AudioDeviceInfo.TYPE_WIRED_HEADSET,
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_ACCESSORY,
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
            AudioDeviceInfo.TYPE_LINE_ANALOG,
            AudioDeviceInfo.TYPE_LINE_DIGITAL -> true
            else -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                type == AudioDeviceInfo.TYPE_BLE_HEADSET
        }
    }

    private fun deviceTypeLabel(type: Int): String {
        return when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Built-in Microphone"
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired Headset Mic"
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB Audio Input"
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth Headset (SCO)"
            AudioDeviceInfo.TYPE_LINE_ANALOG,
            AudioDeviceInfo.TYPE_LINE_DIGITAL -> "Line Input"
            else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                type == AudioDeviceInfo.TYPE_BLE_HEADSET
            ) {
                "BLE Audio Headset"
            } else {
                "Audio Input"
            }
        }
    }
}
