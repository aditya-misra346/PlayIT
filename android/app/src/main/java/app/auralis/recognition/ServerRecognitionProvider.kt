package app.auralis.recognition

import app.auralis.dsp.ProcessedAudio

/**
 * Primary recognition provider that uploads a 16 kHz mono 16-bit PCM WAV sample to
 * `POST /api/v1/recognize` via [AuralisApiClient].
 */
class ServerRecognitionProvider(
    private val apiClient: AuralisApiClient
) : RecognitionProvider {

    override val id: String = "server"
    override val displayName: String = "Auralis Server (AudD / ACRCloud)"
    override val isAvailable: Boolean = true

    override suspend fun recognize(
        audio: ProcessedAudio,
        source: String,
        preferredServerProvider: String?
    ): RecognitionOutcome {
        return apiClient.recognize(
            audio = audio,
            source = source,
            providerOverride = preferredServerProvider
        )
    }
}
