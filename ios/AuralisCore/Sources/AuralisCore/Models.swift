import Foundation

// MARK: - Recognition States (per CONTRACT.md)

public enum RecognitionState: String, Codable, CaseIterable, Sendable, Equatable {
    case idle = "idle"
    case requestingPermission = "requesting_permission"
    case listening = "listening"
    case analyzing = "analyzing"
    case identifying = "identifying"
    case matched = "matched"
    case noMatch = "no_match"
    case micUnavailable = "mic_unavailable"
    case connectionError = "connection_error"
    case serviceUnavailable = "service_unavailable"
    case tooQuiet = "too_quiet"

    public var displayTitle: String {
        switch self {
        case .idle:
            return "Ready to identify"
        case .requestingPermission:
            return "Requesting Microphone Access…"
        case .listening:
            return "Listening for Music…"
        case .analyzing:
            return "Analyzing Audio Quality…"
        case .identifying:
            return "Identifying Song…"
        case .matched:
            return "Song Identified"
        case .noMatch:
            return "No Song Match Found"
        case .micUnavailable:
            return "Microphone Unavailable"
        case .connectionError:
            return "Connection Error"
        case .serviceUnavailable:
            return "Recognition Service Unavailable"
        case .tooQuiet:
            return "Audio Too Quiet"
        }
    }

    public var defaultSubtitle: String {
        switch self {
        case .idle:
            return "Tap the Auralis button to identify music playing around you."
        case .requestingPermission:
            return "Please grant microphone access so Auralis can hear nearby music."
        case .listening:
            return "Hold your device toward the music source. Capturing ~10 seconds."
        case .analyzing:
            return "Checking signal level and preparing audio signature…"
        case .identifying:
            return "Matching acoustic fingerprint against music catalog…"
        case .matched:
            return "Matched your audio sample."
        case .noMatch:
            return "We heard the audio clearly, but couldn't match it in the catalog."
        case .micUnavailable:
            return "Microphone permission was denied or the input device was disconnected."
        case .connectionError:
            return "Check your internet connection and try again."
        case .serviceUnavailable:
            return "The recognition provider is temporarily unavailable, unconfigured, or over quota."
        case .tooQuiet:
            return "Move closer to the music or turn it up."
        }
    }

    public var isActiveCaptureOrProcessing: Bool {
        switch self {
        case .requestingPermission, .listening, .analyzing, .identifying:
            return true
        default:
            return false
        }
    }
}

// MARK: - Provider Selection (Settings)

public enum RecognitionProviderMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case shazamKit = "shazamkit"
    case auralisCloud = "auralis_cloud"
    case auto = "auto"

    public var id: String { rawValue }

    public var displayName: String {
        switch self {
        case .shazamKit:
            return "ShazamKit (On-Device Signature)"
        case .auralisCloud:
            return "Auralis Cloud Server"
        case .auto:
            return "Auto (ShazamKit with Cloud Fallback on Service Error)"
        }
    }

    public var summaryDescription: String {
        switch self {
        case .shazamKit:
            return "Computes an acoustic signature on-device using Apple ShazamKit and matches against the Shazam catalog."
        case .auralisCloud:
            return "Encodes a 16 kHz mono WAV clip after quality checks and sends it to the Auralis recognition server."
        case .auto:
            return "Attempts on-device ShazamKit first, automatically falling back to the Auralis Cloud Server if ShazamKit is unavailable or encounters a service error."
        }
    }
}

// MARK: - Normalized TrackMatch (per CONTRACT.md)

public struct TrackArtwork: Codable, Equatable, Hashable, Sendable {
    public let url: String
    public let thumbUrl: String?
    public let width: Int?
    public let height: Int?

    public init(url: String, thumbUrl: String? = nil, width: Int? = nil, height: Int? = nil) {
        self.url = url
        self.thumbUrl = thumbUrl
        self.width = width
        self.height = height
    }
}

public struct TrackLink: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let service: String
    public let url: String
    public let label: String

    public var id: String { "\(service):\(url)" }

    public init(service: String, url: String, label: String) {
        self.service = service
        self.url = url
        self.label = label
    }
}

public struct MatchConfidence: Codable, Equatable, Hashable, Sendable {
    public let value: Int
    public let scale: Int

    public init(value: Int, scale: Int = 100) {
        self.value = value
        self.scale = scale
    }

    public var formattedPercentage: String {
        guard scale > 0 else { return "\(value)" }
        let pct = Int((Double(value) / Double(scale) * 100.0).rounded())
        return "\(pct)%"
    }
}

public struct MatchMetadata: Codable, Equatable, Hashable, Sendable {
    public let provider: String
    public let offsetMs: Int?
    public let timecode: String?
    public let confidence: MatchConfidence?
    public let recognizedAt: String
    public let source: String
    public let platform: String

    public init(
        provider: String,
        offsetMs: Int? = nil,
        timecode: String? = nil,
        confidence: MatchConfidence? = nil,
        recognizedAt: String,
        source: String = "microphone",
        platform: String = "ios"
    ) {
        self.provider = provider
        self.offsetMs = offsetMs
        self.timecode = timecode
        self.confidence = confidence
        self.recognizedAt = recognizedAt
        self.source = source
        self.platform = platform
    }

    public var providerDisplayName: String {
        switch provider.lowercased() {
        case "shazamkit":
            return "ShazamKit"
        case "audd":
            return "AudD"
        case "acrcloud":
            return "ACRCloud"
        case "local":
            return "Auralis Local"
        default:
            return provider.capitalized
        }
    }

    public static func formatTimecode(fromOffsetMs offsetMs: Int?) -> String? {
        guard let offsetMs = offsetMs, offsetMs >= 0 else { return nil }
        let totalSeconds = offsetMs / 1000
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

public struct TrackMatch: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let artists: [String]
    public let artist: String
    public let album: String?
    public let releaseDate: String?
    public let year: Int?
    public let genres: [String]
    public let label: String?
    public let isrc: String?
    public let durationMs: Int?
    public let artwork: TrackArtwork?
    public let previewUrl: String?
    public let links: [TrackLink]
    public let match: MatchMetadata

    public init(
        id: String,
        title: String,
        artists: [String],
        artist: String,
        album: String? = nil,
        releaseDate: String? = nil,
        year: Int? = nil,
        genres: [String] = [],
        label: String? = nil,
        isrc: String? = nil,
        durationMs: Int? = nil,
        artwork: TrackArtwork? = nil,
        previewUrl: String? = nil,
        links: [TrackLink] = [],
        match: MatchMetadata
    ) {
        self.id = id
        self.title = title
        self.artists = artists
        self.artist = artist
        self.album = album
        self.releaseDate = releaseDate
        self.year = year
        self.genres = genres
        self.label = label
        self.isrc = isrc
        self.durationMs = durationMs
        self.artwork = artwork
        self.previewUrl = previewUrl
        self.links = links
        self.match = match
    }

    /// Formatted share/copy summary for clipboard and ShareLink
    public var shareFormattedSummary: String {
        var lines: [String] = ["\(title) — \(artist)"]
        if let album = album, !album.isEmpty {
            if let year = year {
                lines.append("Album: \(album) (\(year))")
            } else {
                lines.append("Album: \(album)")
            }
        } else if let year = year {
            lines.append("Year: \(year)")
        }
        if let timecode = match.timecode {
            lines.append("Matched at: \(timecode)")
        }
        if let firstLink = links.first {
            lines.append("\(firstLink.label): \(firstLink.url)")
        }
        lines.append("Identified with Auralis")
        return lines.joined(separator: "\n")
    }
}

// MARK: - Library Item (per CONTRACT.md)

public struct LibraryItem: Codable, Equatable, Hashable, Identifiable, Sendable {
    public let id: String
    public var track: TrackMatch
    public var favorite: Bool
    public let createdAt: String
    public var updatedAt: String
    public var deleted: Bool?

    public init(
        id: String = UUID().uuidString.lowercased(),
        track: TrackMatch,
        favorite: Bool = false,
        createdAt: String = ISO8601DateFormatter().string(from: Date()),
        updatedAt: String = ISO8601DateFormatter().string(from: Date()),
        deleted: Bool? = nil
    ) {
        self.id = id
        self.track = track
        self.favorite = favorite
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deleted = deleted
    }
}

// MARK: - HTTP API Payloads (per CONTRACT.md)

public struct ServerProviderDescriptor: Codable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let role: String
    public let processing: String
    public let confidence: Bool

    public init(id: String, name: String, role: String, processing: String, confidence: Bool) {
        self.id = id
        self.name = name
        self.role = role
        self.processing = processing
        self.confidence = confidence
    }
}

public struct ServerCaptureConfig: Codable, Equatable, Sendable {
    public let targetSeconds: Int
    public let maxSeconds: Int
    public let minSeconds: Int
    public let sampleRate: Int
    public let maxUploadBytes: Int

    public init(
        targetSeconds: Int = 10,
        maxSeconds: Int = 12,
        minSeconds: Int = 4,
        sampleRate: Int = 16000,
        maxUploadBytes: Int = 1_048_576
    ) {
        self.targetSeconds = targetSeconds
        self.maxSeconds = maxSeconds
        self.minSeconds = minSeconds
        self.sampleRate = sampleRate
        self.maxUploadBytes = maxUploadBytes
    }
}

public struct ServerConfigResponse: Codable, Equatable, Sendable {
    public let providers: [ServerProviderDescriptor]
    public let capture: ServerCaptureConfig
    public let disclosure: String
    public let shazamkitTokens: Bool
    public let accounts: Bool

    public init(
        providers: [ServerProviderDescriptor],
        capture: ServerCaptureConfig,
        disclosure: String,
        shazamkitTokens: Bool,
        accounts: Bool
    ) {
        self.providers = providers
        self.capture = capture
        self.disclosure = disclosure
        self.shazamkitTokens = shazamkitTokens
        self.accounts = accounts
    }
}

public struct RecognizedProviderSummary: Codable, Equatable, Sendable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct RecognizeResponse: Codable, Equatable, Sendable {
    public let status: String
    public let requestId: String
    public let latencyMs: Int?
    public let provider: RecognizedProviderSummary?
    public let result: TrackMatch?

    public init(
        status: String,
        requestId: String,
        latencyMs: Int? = nil,
        provider: RecognizedProviderSummary? = nil,
        result: TrackMatch? = nil
    ) {
        self.status = status
        self.requestId = requestId
        self.latencyMs = latencyMs
        self.provider = provider
        self.result = result
    }
}

public enum AuralisAPIErrorCode: String, Codable, Sendable {
    case audioTooShort = "AUDIO_TOO_SHORT"
    case audioSilent = "AUDIO_SILENT"
    case unsupportedFormat = "UNSUPPORTED_FORMAT"
    case payloadTooLarge = "PAYLOAD_TOO_LARGE"
    case rateLimited = "RATE_LIMITED"
    case providerAuth = "PROVIDER_AUTH"
    case providerQuota = "PROVIDER_QUOTA"
    case providerUnavailable = "PROVIDER_UNAVAILABLE"
    case notConfigured = "NOT_CONFIGURED"
    case unauthorized = "UNAUTHORIZED"
    case internalError = "INTERNAL"
    case unknown = "UNKNOWN"

    public var mappedRecognitionState: RecognitionState {
        switch self {
        case .audioSilent, .audioTooShort:
            return .tooQuiet
        case .providerAuth, .providerQuota, .providerUnavailable, .notConfigured, .rateLimited, .internalError, .unsupportedFormat, .payloadTooLarge, .unauthorized:
            return .serviceUnavailable
        case .unknown:
            return .serviceUnavailable
        }
    }
}

public struct APIErrorDetail: Codable, Equatable, Sendable {
    public let code: String
    public let message: String
    public let retryable: Bool

    public init(code: String, message: String, retryable: Bool) {
        self.code = code
        self.message = message
        self.retryable = retryable
    }

    public var typedCode: AuralisAPIErrorCode {
        AuralisAPIErrorCode(rawValue: code) ?? .unknown
    }
}

public struct APIErrorEnvelope: Codable, Equatable, Sendable {
    public let error: APIErrorDetail

    public init(error: APIErrorDetail) {
        self.error = error
    }
}

public struct ShazamKitTokenResponse: Codable, Equatable, Sendable {
    public let token: String
    public let expiresAt: String

    public init(token: String, expiresAt: String) {
        self.token = token
        self.expiresAt = expiresAt
    }
}

public struct AuthUser: Codable, Equatable, Sendable {
    public let id: String
    public let email: String

    public init(id: String, email: String) {
        self.id = id
        self.email = email
    }
}

public struct AuthCredentialsRequest: Codable, Equatable, Sendable {
    public let email: String
    public let password: String

    public init(email: String, password: String) {
        self.email = email
        self.password = password
    }
}

public struct AuthResponse: Codable, Equatable, Sendable {
    public let token: String
    public let user: AuthUser

    public init(token: String, user: AuthUser) {
        self.token = token
        self.user = user
    }
}

public struct LibrarySyncRequest: Codable, Equatable, Sendable {
    public let items: [LibraryItem]

    public init(items: [LibraryItem]) {
        self.items = items
    }
}

public struct LibrarySyncResponse: Codable, Equatable, Sendable {
    public let items: [LibraryItem]
    public let serverTime: String

    public init(items: [LibraryItem], serverTime: String) {
        self.items = items
        self.serverTime = serverTime
    }
}
