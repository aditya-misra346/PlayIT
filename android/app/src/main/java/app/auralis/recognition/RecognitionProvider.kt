package app.auralis.recognition

import app.auralis.dsp.ProcessedAudio
import app.auralis.model.RecognitionState
import app.auralis.model.TrackMatch

sealed class RecognitionOutcome {
    data class Match(
        val track: TrackMatch,
        val providerId: String,
        val providerName: String,
        val latencyMs: Long? = null
    ) : RecognitionOutcome()

    data class NoMatch(
        val providerId: String,
        val providerName: String,
        val latencyMs: Long? = null
    ) : RecognitionOutcome()

    data class TooQuiet(
        val message: String
    ) : RecognitionOutcome()

    data class ConnectionError(
        val message: String,
        val retryable: Boolean = true
    ) : RecognitionOutcome()

    data class ServiceUnavailable(
        val code: String,
        val message: String,
        val retryable: Boolean = false,
        val retryAfterSeconds: Long? = null
    ) : RecognitionOutcome()

    fun toRecognitionState(): RecognitionState = when (this) {
        is Match -> RecognitionState.MATCHED
        is NoMatch -> RecognitionState.NO_MATCH
        is TooQuiet -> RecognitionState.TOO_QUIET
        is ConnectionError -> RecognitionState.CONNECTION_ERROR
        is ServiceUnavailable -> RecognitionState.SERVICE_UNAVAILABLE
    }
}

interface RecognitionProvider {
    val id: String
    val displayName: String
    val isAvailable: Boolean

    suspend fun recognize(
        audio: ProcessedAudio,
        source: String,
        preferredServerProvider: String? = null
    ): RecognitionOutcome
}
