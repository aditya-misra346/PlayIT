import Foundation
import AVFoundation
import ShazamKit

// MARK: - ShazamKit Media Item Representation & Mapper

public struct ShazamMatchedMediaSnapshot: Equatable, Sendable {
    public let shazamID: String?
    public let title: String?
    public let artist: String?
    public let subtitle: String?
    public let album: String?
    public let isrc: String?
    public let genres: [String]
    public let artworkURL: URL?
    public let appleMusicURL: URL?
    public let appleMusicID: String?
    public let webURL: URL?
    public let predictedCurrentMatchOffset: TimeInterval?
    public let matchOffset: TimeInterval?

    public init(
        shazamID: String? = nil,
        title: String? = nil,
        artist: String? = nil,
        subtitle: String? = nil,
        album: String? = nil,
        isrc: String? = nil,
        genres: [String] = [],
        artworkURL: URL? = nil,
        appleMusicURL: URL? = nil,
        appleMusicID: String? = nil,
        webURL: URL? = nil,
        predictedCurrentMatchOffset: TimeInterval? = nil,
        matchOffset: TimeInterval? = nil
    ) {
        self.shazamID = shazamID
        self.title = title
        self.artist = artist
        self.subtitle = subtitle
        self.album = album
        self.isrc = isrc
        self.genres = genres
        self.artworkURL = artworkURL
        self.appleMusicURL = appleMusicURL
        self.appleMusicID = appleMusicID
        self.webURL = webURL
        self.predictedCurrentMatchOffset = predictedCurrentMatchOffset
        self.matchOffset = matchOffset
    }

    public init(matchedItem: SHMatchedMediaItem) {
        self.shazamID = matchedItem.shazamID
        self.title = matchedItem.title
        self.artist = matchedItem.artist
        self.subtitle = matchedItem.subtitle
        self.album = matchedItem[SHMediaItemProperty("sh_albumName")] as? String
        self.isrc = matchedItem.isrc ?? (matchedItem[SHMediaItemProperty("sh_isrc")] as? String)
        self.genres = matchedItem.genres
        self.artworkURL = matchedItem.artworkURL
        self.appleMusicURL = matchedItem.appleMusicURL
        self.appleMusicID = matchedItem.appleMusicID
        self.webURL = matchedItem.webURL
        self.predictedCurrentMatchOffset = matchedItem.predictedCurrentMatchOffset
        self.matchOffset = matchedItem.matchOffset
    }

    public init(mediaItem: SHMediaItem, predictedCurrentMatchOffset: TimeInterval? = nil, matchOffset: TimeInterval? = nil) {
        self.shazamID = mediaItem.shazamID
        self.title = mediaItem.title
        self.artist = mediaItem.artist
        self.subtitle = mediaItem.subtitle
        self.album = mediaItem[SHMediaItemProperty("sh_albumName")] as? String
        self.isrc = mediaItem.isrc ?? (mediaItem[SHMediaItemProperty("sh_isrc")] as? String)
        self.genres = mediaItem.genres
        self.artworkURL = mediaItem.artworkURL
        self.appleMusicURL = mediaItem.appleMusicURL
        self.appleMusicID = mediaItem.appleMusicID
        self.webURL = mediaItem.webURL
        self.predictedCurrentMatchOffset = predictedCurrentMatchOffset
        self.matchOffset = matchOffset
    }
}

public enum ShazamKitMapper {
    /// Maps an `SHMatchedMediaItem` directly to a normalized `TrackMatch` per CONTRACT.md.
    /// Note: `confidence` is ALWAYS `nil` for ShazamKit (never fabricate confidence).
    public static func map(
        matchedItem: SHMatchedMediaItem,
        recognizedAt: Date = Date(),
        source: String = "microphone",
        platform: String = "ios"
    ) -> TrackMatch {
        let snapshot = ShazamMatchedMediaSnapshot(matchedItem: matchedItem)
        return map(
            snapshot: snapshot,
            recognizedAt: recognizedAt,
            source: source,
            platform: platform
        )
    }

    /// Maps a `ShazamMatchedMediaSnapshot` (or `SHMediaItem`) to `TrackMatch` per CONTRACT.md.
    public static func map(
        snapshot: ShazamMatchedMediaSnapshot,
        recognizedAt: Date = Date(),
        source: String = "microphone",
        platform: String = "ios"
    ) -> TrackMatch {
        let trimmedTitle = snapshot.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = (trimmedTitle?.isEmpty == false) ? trimmedTitle! : "Unknown Track"

        let rawArtist = snapshot.artist?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? snapshot.subtitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        let artist = (rawArtist?.isEmpty == false) ? rawArtist! : "Unknown Artist"
        let artists = parseArtists(from: artist)

        let normalizedIsrc = snapshot.isrc?.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalIsrc = (normalizedIsrc?.isEmpty == false) ? normalizedIsrc : nil

        let trackId: String
        if let isrc = finalIsrc {
            trackId = "isrc:\(isrc)"
        } else if let shazamID = snapshot.shazamID?.trimmingCharacters(in: .whitespacesAndNewlines), !shazamID.isEmpty {
            trackId = "shazamkit:\(shazamID)"
        } else {
            let slug = "\(title.lowercased())|\(artist.lowercased())"
            let digest = deterministicHexHash(slug)
            trackId = "hash:\(digest)"
        }

        let artwork: TrackArtwork?
        if let artworkURL = snapshot.artworkURL {
            artwork = TrackArtwork(
                url: artworkURL.absoluteString,
                thumbUrl: artworkURL.absoluteString,
                width: nil,
                height: nil
            )
        } else {
            artwork = nil
        }

        // Only include links actually returned by ShazamKit
        var links: [TrackLink] = []
        if let appleMusicURL = snapshot.appleMusicURL {
            links.append(
                TrackLink(
                    service: "apple_music",
                    url: appleMusicURL.absoluteString,
                    label: "Apple Music"
                )
            )
        }
        if let webURL = snapshot.webURL {
            links.append(
                TrackLink(
                    service: "shazam",
                    url: webURL.absoluteString,
                    label: "Shazam"
                )
            )
        }

        // Offset & timecode from predictedCurrentMatchOffset (or matchOffset fallback)
        let effectiveOffsetSeconds: TimeInterval? = {
            if let predicted = snapshot.predictedCurrentMatchOffset, predicted.isFinite, predicted >= 0 {
                return predicted
            }
            if let rawOffset = snapshot.matchOffset, rawOffset.isFinite, rawOffset >= 0 {
                return rawOffset
            }
            return nil
        }()

        let offsetMs: Int? = effectiveOffsetSeconds.map { Int(($0 * 1000.0).rounded()) }
        let timecode: String? = MatchMetadata.formatTimecode(fromOffsetMs: offsetMs)

        let isoFormatter = ISO8601DateFormatter()
        let recognizedAtIso = isoFormatter.string(from: recognizedAt)

        // Never fabricate confidence for ShazamKit
        let metadata = MatchMetadata(
            provider: "shazamkit",
            offsetMs: offsetMs,
            timecode: timecode,
            confidence: nil,
            recognizedAt: recognizedAtIso,
            source: source,
            platform: platform
        )

        let cleanAlbum = snapshot.album?.trimmingCharacters(in: .whitespacesAndNewlines)

        return TrackMatch(
            id: trackId,
            title: title,
            artists: artists,
            artist: artist,
            album: (cleanAlbum?.isEmpty == false) ? cleanAlbum : nil,
            releaseDate: nil,
            year: nil,
            genres: snapshot.genres,
            label: nil,
            isrc: finalIsrc,
            durationMs: nil,
            artwork: artwork,
            previewUrl: nil,
            links: links,
            match: metadata
        )
    }

    private static func parseArtists(from displayArtist: String) -> [String] {
        let separators = [", ", " & ", " feat. ", " ft. ", " x "]
        var parts = [displayArtist]
        for sep in separators {
            if displayArtist.localizedCaseInsensitiveContains(sep) {
                parts = displayArtist
                    .components(separatedBy: sep)
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                break
            }
        }
        return parts.isEmpty ? [displayArtist] : parts
    }

    private static func deterministicHexHash(_ input: String) -> String {
        // FNV-1a 64-bit deterministic hash
        var hash: UInt64 = 14695981039346656037
        for byte in input.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1099511628211
        }
        return String(format: "%016llx", hash)
    }
}

// MARK: - On-Device ShazamKit Signature Generator & Session Coordinator

public enum ShazamKitServiceError: Error, LocalizedError, Equatable, Sendable {
    case signatureGenerationFailed(String)
    case sessionFailed(String)
    case catalogUnavailable(String)

    public var errorDescription: String? {
        switch self {
        case .signatureGenerationFailed(let reason):
            return "Could not generate ShazamKit acoustic signature: \(reason)"
        case .sessionFailed(let reason):
            return "ShazamKit catalog matching failed: \(reason)"
        case .catalogUnavailable(let reason):
            return "ShazamKit service is unavailable or not entitled: \(reason)"
        }
    }
}

public enum ShazamKitMatchOutcome: Equatable, Sendable {
    case matched(TrackMatch)
    case noMatch
    case serviceError(ShazamKitServiceError)
}

public protocol ShazamKitRecognizing: Sendable {
    func match(pcmBuffers: [AVAudioPCMBuffer], platform: String) async -> ShazamKitMatchOutcome
    func match(monoSamples: [Float], sampleRate: Double, platform: String) async -> ShazamKitMatchOutcome
}

/// Concrete ShazamKit recognizer using `SHSignatureGenerator` + `SHSession` (and compatible with iOS 16+ / iOS 17+ `SHManagedSession`).
public final class AppleShazamKitRecognizer: NSObject, ShazamKitRecognizing, @unchecked Sendable {
    public override init() {
        super.init()
    }

    /// Generates an `SHSignature` from mono float samples by converting them into an `AVAudioPCMBuffer`.
    public static func makeSignature(fromMonoSamples samples: [Float], sampleRate: Double) throws -> SHSignature {
        guard !samples.isEmpty, sampleRate > 0 else {
            throw ShazamKitServiceError.signatureGenerationFailed("Empty audio sample buffer")
        }
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1),
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count)) else {
            throw ShazamKitServiceError.signatureGenerationFailed("Failed to allocate PCM buffer")
        }
        pcmBuffer.frameLength = AVAudioFrameCount(samples.count)
        if let channelData = pcmBuffer.floatChannelData?[0] {
            for i in 0..<samples.count {
                channelData[i] = samples[i]
            }
        }
        return try makeSignature(fromPCMPreRecordedBuffers: [pcmBuffer])
    }

    /// Generates an `SHSignature` from captured `AVAudioPCMBuffer` slices using `SHSignatureGenerator`.
    public static func makeSignature(fromPCMPreRecordedBuffers buffers: [AVAudioPCMBuffer]) throws -> SHSignature {
        guard !buffers.isEmpty else {
            throw ShazamKitServiceError.signatureGenerationFailed("No PCM buffers captured")
        }
        let generator = SHSignatureGenerator()
        for buffer in buffers where buffer.frameLength > 0 {
            do {
                try generator.append(buffer, at: nil)
            } catch {
                throw ShazamKitServiceError.signatureGenerationFailed(error.localizedDescription)
            }
        }
        return generator.signature()
    }

    public func match(monoSamples: [Float], sampleRate: Double, platform: String = "ios") async -> ShazamKitMatchOutcome {
        do {
            let signature = try Self.makeSignature(fromMonoSamples: monoSamples, sampleRate: sampleRate)
            return await matchSignature(signature, platform: platform)
        } catch let error as ShazamKitServiceError {
            return .serviceError(error)
        } catch {
            return .serviceError(.signatureGenerationFailed(error.localizedDescription))
        }
    }

    public func match(pcmBuffers: [AVAudioPCMBuffer], platform: String = "ios") async -> ShazamKitMatchOutcome {
        do {
            let signature = try Self.makeSignature(fromPCMPreRecordedBuffers: pcmBuffers)
            return await matchSignature(signature, platform: platform)
        } catch let error as ShazamKitServiceError {
            return .serviceError(error)
        } catch {
            return .serviceError(.signatureGenerationFailed(error.localizedDescription))
        }
    }

    /// Uses Apple's iOS 17+ / macOS 14+ `SHManagedSession` when direct managed session matching is requested.
    @available(iOS 17.0, macOS 14.0, *)
    public func matchUsingManagedSession(platform: String = "ios") async -> ShazamKitMatchOutcome {
        let managedSession = SHManagedSession()
        let result = await managedSession.result()
        switch result {
        case .match(let match):
            guard let firstItem = match.mediaItems.first else {
                return .noMatch
            }
            return .matched(ShazamKitMapper.map(matchedItem: firstItem, platform: platform))
        case .noMatch:
            return .noMatch
        case .error(let error, _):
            return .serviceError(.sessionFailed(error.localizedDescription))
        @unknown default:
            return .noMatch
        }
    }

    private func matchSignature(_ signature: SHSignature, platform: String) async -> ShazamKitMatchOutcome {
        let session = SHSession()
        let bridge = SessionDelegateBridge(platform: platform)
        session.delegate = bridge
        return await bridge.performMatch(in: session, signature: signature)
    }
}

private final class SessionDelegateBridge: NSObject, SHSessionDelegate, @unchecked Sendable {
    private let platform: String
    private let lock = NSLock()
    private var continuation: CheckedContinuation<ShazamKitMatchOutcome, Never>?

    init(platform: String) {
        self.platform = platform
        super.init()
    }

    func performMatch(in session: SHSession, signature: SHSignature) async -> ShazamKitMatchOutcome {
        await withCheckedContinuation { (cont: CheckedContinuation<ShazamKitMatchOutcome, Never>) in
            lock.lock()
            self.continuation = cont
            lock.unlock()
            session.match(signature)
        }
    }

    func session(_ session: SHSession, didFind match: SHMatch) {
        guard let firstItem = match.mediaItems.first else {
            resumeOnce(with: .noMatch)
            return
        }
        let mapped = ShazamKitMapper.map(matchedItem: firstItem, platform: platform)
        resumeOnce(with: .matched(mapped))
    }

    func session(_ session: SHSession, didNotFindMatchFor signature: SHSignature, error: (any Error)?) {
        if let error = error {
            resumeOnce(with: .serviceError(.sessionFailed(error.localizedDescription)))
        } else {
            resumeOnce(with: .noMatch)
        }
    }

    private func resumeOnce(with outcome: ShazamKitMatchOutcome) {
        lock.lock()
        let cont = continuation
        continuation = nil
        lock.unlock()
        cont?.resume(returning: outcome)
    }
}
