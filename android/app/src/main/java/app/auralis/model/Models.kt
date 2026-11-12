package app.auralis.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * All 11 contract recognition states from docs/CONTRACT.md.
 */
enum class RecognitionState(val wireName: String, val title: String, val subtitle: String) {
    IDLE(
        wireName = "idle",
        title = "Ready to identify",
        subtitle = "Tap the Auralis button to listen for music around you."
    ),
    REQUESTING_PERMISSION(
        wireName = "requesting_permission",
        title = "Microphone permission needed",
        subtitle = "Grant microphone access so Auralis can hear the music."
    ),
    LISTENING(
        wireName = "listening",
        title = "Listening…",
        subtitle = "Hold your device toward the music source."
    ),
    ANALYZING(
        wireName = "analyzing",
        title = "Analyzing sample…",
        subtitle = "Checking audio clarity and encoding 16 kHz mono PCM."
    ),
    IDENTIFYING(
        wireName = "identifying",
        title = "Identifying track…",
        subtitle = "Matching audio fingerprint against catalog."
    ),
    MATCHED(
        wireName = "matched",
        title = "Track identified",
        subtitle = "We found a match for what's playing."
    ),
    NO_MATCH(
        wireName = "no_match",
        title = "No match found",
        subtitle = "We couldn't identify that song. Try again closer to the speaker."
    ),
    MIC_UNAVAILABLE(
        wireName = "mic_unavailable",
        title = "Microphone unavailable",
        subtitle = "Permission was denied, no input device was found, or the microphone disconnected."
    ),
    CONNECTION_ERROR(
        wireName = "connection_error",
        title = "Connection error",
        subtitle = "Could not reach the Auralis recognition server. Check your network or API URL."
    ),
    SERVICE_UNAVAILABLE(
        wireName = "service_unavailable",
        title = "Service unavailable",
        subtitle = "The recognition provider is temporarily unavailable, not configured, or out of quota."
    ),
    TOO_QUIET(
        wireName = "too_quiet",
        title = "Too quiet to identify",
        subtitle = "Move closer to the music or turn it up"
    );

    val isActiveCaptureOrProcessing: Boolean
        get() = this == LISTENING || this == ANALYZING || this == IDENTIFYING
}

@Serializable
data class TrackArtwork(
    val url: String,
    val thumbUrl: String? = null,
    val width: Int? = null,
    val height: Int? = null
)

@Serializable
data class TrackLink(
    val service: String,
    val url: String,
    val label: String
)

@Serializable
data class MatchConfidence(
    val value: Int,
    val scale: Int = 100
)

@Serializable
data class MatchMetadata(
    val provider: String,
    val offsetMs: Long? = null,
    val timecode: String? = null,
    val confidence: MatchConfidence? = null,
    val recognizedAt: String,
    val source: String = "microphone",
    val platform: String = "android"
)

/**
 * Normalized TrackMatch schema per docs/CONTRACT.md.
 */
@Serializable
data class TrackMatch(
    val id: String,
    val title: String,
    val artists: List<String> = emptyList(),
    val artist: String,
    val album: String? = null,
    val releaseDate: String? = null,
    val year: Int? = null,
    val genres: List<String> = emptyList(),
    val label: String? = null,
    val isrc: String? = null,
    val durationMs: Long? = null,
    val artwork: TrackArtwork? = null,
    val previewUrl: String? = null,
    val links: List<TrackLink> = emptyList(),
    val match: MatchMetadata
)

/**
 * Normalized LibraryItem stored in local history and synced with the server.
 * Raw audio is never stored.
 */
@Serializable
data class LibraryItem(
    val id: String,
    val track: TrackMatch,
    val favorite: Boolean = false,
    val createdAt: String,
    val updatedAt: String,
    val deleted: Boolean = false
)

// ---- HTTP API Contract Envelopes ------------------------------------------------------------

@Serializable
data class ProviderConfigInfo(
    val id: String,
    val name: String,
    val role: String = "primary",
    val processing: String = "server",
    val confidence: Boolean = false
)

@Serializable
data class CaptureConfigInfo(
    val targetSeconds: Int = 10,
    val maxSeconds: Int = 12,
    val minSeconds: Int = 4,
    val sampleRate: Int = 16000,
    val maxUploadBytes: Long = 1048576L
)

@Serializable
data class ServerConfigResponse(
    val providers: List<ProviderConfigInfo> = emptyList(),
    val capture: CaptureConfigInfo = CaptureConfigInfo(),
    val disclosure: String = DEFAULT_DISCLOSURE,
    val shazamkitTokens: Boolean = false,
    val accounts: Boolean = true
) {
    companion object {
        const val DEFAULT_DISCLOSURE =
            "A ~10-second audio sample is sent to our server and processed by the configured recognition provider to identify the song. It is not stored."
    }
}

@Serializable
data class ProviderSummary(
    val id: String,
    val name: String
)

@Serializable
data class RecognizeResponse(
    val status: String,
    val requestId: String? = null,
    val latencyMs: Long? = null,
    val provider: ProviderSummary? = null,
    val result: TrackMatch? = null
)

@Serializable
data class ApiErrorDetail(
    val code: String,
    val message: String,
    val retryable: Boolean = false
)

@Serializable
data class ApiErrorEnvelope(
    val error: ApiErrorDetail
)

@Serializable
data class ShazamKitTokenResponse(
    val token: String,
    val expiresAt: String
)

@Serializable
data class AuthCredentialsRequest(
    val email: String,
    val password: String
)

@Serializable
data class AuthUser(
    val id: String,
    val email: String
)

@Serializable
data class AuthSessionResponse(
    val token: String,
    val user: AuthUser
)

@Serializable
data class LibraryListResponse(
    val items: List<LibraryItem> = emptyList(),
    val serverTime: String? = null
)

@Serializable
data class LibrarySyncRequest(
    val items: List<LibraryItem>
)

@Serializable
data class LibrarySyncResponse(
    val items: List<LibraryItem> = emptyList(),
    val serverTime: String
)
