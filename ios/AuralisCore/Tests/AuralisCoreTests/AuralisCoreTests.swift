import Foundation
import AVFoundation
import ShazamKit
import Testing
@testable import AuralisCore

@Suite("AuralisCore Comprehensive Unit Tests")
struct AuralisCoreTests {

    // MARK: - 1. Brand & Contract Constants Tests

    @Test("Brand colors and recognition states match CONTRACT.md")
    func testBrandAndStatesContract() {
        #expect(AuralisBrand.productName == "Auralis")
        #expect(AuralisBrand.tagline == "Hear it. Know it.")
        #expect(AuralisBrand.midnightBgHex == "#060A14")
        #expect(AuralisBrand.deepSurfaceHex == "#0B1220")
        #expect(AuralisBrand.charcoalElevatedHex == "#121A2B")
        #expect(AuralisBrand.lineBorderHex == "#1E2A40")
        #expect(AuralisBrand.primaryTextHex == "#EAF2FF")
        #expect(AuralisBrand.mutedTextHex == "#8A9BB8")
        #expect(AuralisBrand.electricBlueHex == "#2F6BFF")
        #expect(AuralisBrand.cyanHex == "#22D3EE")
        #expect(AuralisBrand.tealHex == "#14B8A6")
        #expect(AuralisBrand.dangerHex == "#FF5A6E")
        #expect(AuralisBrand.warningHex == "#FFB547")

        let expectedStates: Set<String> = [
            "idle", "requesting_permission", "listening", "analyzing",
            "identifying", "matched", "no_match", "mic_unavailable",
            "connection_error", "service_unavailable", "too_quiet"
        ]
        let actualStates = Set(RecognitionState.allCases.map(\.rawValue))
        #expect(actualStates == expectedStates)
    }

    // MARK: - 2. DSP & Quality Gate Tests

    @Test("DC offset removal centers biased signal around zero")
    func testDCOffsetRemoval() {
        let biased: [Float] = [0.25, 0.35, 0.15, 0.25, 0.30, 0.20]
        let centered = AudioDSP.removeDCOffset(biased)
        let mean = centered.reduce(0, +) / Float(centered.count)
        #expect(abs(mean) < 1e-5)
    }

    @Test("Stereo to mono and AVAudioPCMBuffer extraction average channels accurately")
    func testStereoToMonoAndPCMBufferExtraction() throws {
        let left: [Float] = [0.8, -0.4, 0.2, 0.0]
        let right: [Float] = [0.2, 0.4, 0.6, -0.5]
        let mono = AudioDSP.stereoToMono(channels: [left, right])
        #expect(mono.count == 4)
        #expect(abs(mono[0] - 0.5) < 1e-6)
        #expect(abs(mono[1] - 0.0) < 1e-6)
        #expect(abs(mono[2] - 0.4) < 1e-6)
        #expect(abs(mono[3] - (-0.25)) < 1e-6)

        // Verify AVAudioPCMBuffer stereo extraction
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 2)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4)!
        buffer.frameLength = 4
        for i in 0..<4 {
            buffer.floatChannelData![0][i] = left[i]
            buffer.floatChannelData![1][i] = right[i]
        }
        let extracted = AudioDSP.extractMonoSamples(from: buffer)
        #expect(extracted.count == 4)
        #expect(abs(extracted[0] - 0.5) < 1e-6)
        #expect(abs(extracted[2] - 0.4) < 1e-6)
    }

    @Test("Live RMS level maps -60..0 dBFS linearly to 0..1")
    func testLiveRMSLevelMapping() {
        #expect(AudioDSP.mapDbfsToNormalizedLevel(-80.0) == 0.0)
        #expect(AudioDSP.mapDbfsToNormalizedLevel(-60.0) == 0.0)
        #expect(abs(AudioDSP.mapDbfsToNormalizedLevel(-30.0) - 0.5) < 1e-6)
        #expect(AudioDSP.mapDbfsToNormalizedLevel(0.0) == 1.0)
        #expect(AudioDSP.mapDbfsToNormalizedLevel(3.0) == 1.0)

        let sr = 16000.0
        let count = Int(sr * 0.1)
        let sine = (0..<count).map { i in
            Float(sin(2.0 * Double.pi * 440.0 * Double(i) / sr))
        }
        let live = AudioDSP.computeLiveLevel(samples: sine, sampleRate: sr)
        #expect(live.rmsNormalized > 0.90 && live.rmsNormalized <= 1.0)
        #expect(live.peak > 0.99)
    }

    @Test("Quality gate detects too_quiet when RMS < -50 dBFS or silenceRatio > 0.85")
    func testQualityGateTooQuiet() {
        let sr = 16000
        let quietSamples = [Float](repeating: 0.0005, count: sr * 5)
        let processed = AudioDSP.processCapturedMonoSamples(quietSamples, inputSampleRate: sr)

        #expect(processed.metrics.rmsDbfs < -50.0)
        #expect(processed.metrics.silenceRatio > 0.85)
        #expect(processed.verdict == .tooQuiet(message: AudioDSP.tooQuietMessage))
        #expect(processed.verdict.shouldUpload == false)
        #expect(processed.wavData.isEmpty)
    }

    @Test("Quality gate detects clipping warning when clippingRatio > 0.05 but still allows upload")
    func testQualityGateClippingWarning() {
        let sr = 16000
        let clippedSamples = (0..<(sr * 5)).map { i -> Float in
            let raw = sin(2.0 * Double.pi * 440.0 * Double(i) / Double(sr)) * 2.5
            return Float(max(-1.0, min(1.0, raw)))
        }
        let processed = AudioDSP.processCapturedMonoSamples(clippedSamples, inputSampleRate: sr)

        #expect(processed.metrics.clippingRatio > 0.05)
        #expect(processed.verdict == .passedWithClippingWarning(hint: AudioDSP.clippingWarningHint))
        #expect(processed.verdict.shouldUpload == true)
        #expect(!processed.wavData.isEmpty)
    }

    @Test("Peak normalization only applies when peak < 0.5")
    func testPeakNormalizationRule() {
        // Peak 0.2 (< 0.5) -> normalized to -1 dBFS (~0.89125)
        let quietSignal: [Float] = [0.1, -0.2, 0.15, -0.05]
        let normalized = AudioDSP.normalizePeakIfQuiet(quietSignal)
        let newPeak = normalized.map { abs($0) }.max() ?? 0
        #expect(abs(newPeak - 0.8912509) < 1e-4)

        // Peak 0.6 (>= 0.5) -> left untouched
        let normalSignal: [Float] = [0.3, -0.6, 0.4, -0.2]
        let untouched = AudioDSP.normalizePeakIfQuiet(normalSignal)
        #expect(untouched == normalSignal)
    }

    @Test("Windowed-sinc resampler converts 48 kHz to 16 kHz and encodes 16-bit mono WAV")
    func testWindowedSincResamplerAndWAVEncoding() {
        let inputRate = 48_000
        let durationSec = 5
        let totalSamples = inputRate * durationSec
        let tone440 = (0..<totalSamples).map { i in
            Float(0.25 * sin(2.0 * Double.pi * 440.0 * Double(i) / Double(inputRate)))
        }

        let processed = AudioDSP.processCapturedMonoSamples(tone440, inputSampleRate: inputRate)
        #expect(processed.verdict == .passed)
        #expect(processed.sampleRate == 16_000)
        #expect(processed.durationMs == 5_000)
        #expect(processed.resampledSamples.count == 16_000 * durationSec)

        let resampledPeak = processed.resampledSamples.map { abs($0) }.max() ?? 0
        #expect(resampledPeak > 0.85 && resampledPeak < 0.92)

        let wav = processed.wavData
        #expect(wav.count == 44 + (16_000 * durationSec * 2))
        let riff = String(data: wav.subdata(in: 0..<4), encoding: .ascii)
        let wave = String(data: wav.subdata(in: 8..<12), encoding: .ascii)
        #expect(riff == "RIFF")
        #expect(wave == "WAVE")
    }

    // MARK: - 3. ShazamKit Mapping Tests

    @Test("ShazamKitMapper maps SHMediaItem and offset to normalized TrackMatch with nil confidence")
    func testShazamKitMapper() {
        let mediaItem = SHMediaItem(properties: [
            .shazamID: "987654321",
            .title: "Midnight City",
            .artist: "M83",
            SHMediaItemProperty("sh_isrc"): "FRUM71100643",
            .genres: ["Electronic", "Indie Pop"],
            .artworkURL: URL(string: "https://is1-ssl.mzstatic.com/image/thumb/Music124/artwork.jpg")!,
            .appleMusicURL: URL(string: "https://music.apple.com/us/album/midnight-city/12345")!,
            .webURL: URL(string: "https://www.shazam.com/track/987654321/midnight-city")!
        ])

        let snapshot = ShazamMatchedMediaSnapshot(
            mediaItem: mediaItem,
            predictedCurrentMatchOffset: 61.2,
            matchOffset: 58.0
        )
        let match = ShazamKitMapper.map(snapshot: snapshot, platform: "ios")

        #expect(match.id == "isrc:FRUM71100643")
        #expect(match.title == "Midnight City")
        #expect(match.artist == "M83")
        #expect(match.artists == ["M83"])
        #expect(match.isrc == "FRUM71100643")
        #expect(match.genres == ["Electronic", "Indie Pop"])
        #expect(match.artwork?.url == "https://is1-ssl.mzstatic.com/image/thumb/Music124/artwork.jpg")
        #expect(match.match.provider == "shazamkit")
        #expect(match.match.offsetMs == 61200)
        #expect(match.match.timecode == "01:01")
        #expect(match.match.confidence == nil)

        #expect(match.links.count == 2)
        #expect(match.links.contains(where: { $0.service == "apple_music" && $0.label == "Apple Music" }))
        #expect(match.links.contains(where: { $0.service == "shazam" && $0.label == "Shazam" }))

        // Fallback ID when ISRC is absent uses shazamkit:<shazamID>
        let noIsrcSnapshot = ShazamMatchedMediaSnapshot(
            shazamID: "555111",
            title: "Test Track",
            artist: "Daft Punk & Pharrell Williams"
        )
        let fallbackMatch = ShazamKitMapper.map(snapshot: noIsrcSnapshot)
        #expect(fallbackMatch.id == "shazamkit:555111")
        #expect(fallbackMatch.artists == ["Daft Punk", "Pharrell Williams"])
        #expect(fallbackMatch.links.isEmpty)
        #expect(fallbackMatch.match.confidence == nil)
    }

    @Test("ShazamKit signature generator builds valid SHSignature from mono samples")
    func testShazamSignatureGeneration() throws {
        let sr = 16000.0
        let samples = (0..<(16000 * 4)).map { i in
            Float(0.5 * sin(2.0 * Double.pi * 523.25 * Double(i) / sr))
        }
        let signature = try AppleShazamKitRecognizer.makeSignature(fromMonoSamples: samples, sampleRate: sr)
        #expect(signature.duration > 3.0)
        #expect(!signature.dataRepresentation.isEmpty)
    }

    // MARK: - 4. LibraryStore Persistence, Filters, Sync Merge, and Schema Migration Tests

    @MainActor
    @Test("LibraryStore migrates Schema V1 to V2, filters by search/artist/date/favorites, merges remote sync, and exports JSON")
    func testLibraryStoreAndMigration() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("auralis-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let fileURL = tempDir.appendingPathComponent("library.json")

        let track1 = TrackMatch(
            id: "isrc:USRC11111111",
            title: "Starlight Echo",
            artists: ["Aurora Pulse"],
            artist: "Aurora Pulse",
            album: "Neon Horizons",
            releaseDate: "2024-05-10",
            year: 2024,
            genres: ["Synthwave"],
            label: "Auralis Records",
            isrc: "USRC11111111",
            durationMs: 215000,
            artwork: TrackArtwork(url: "https://example.com/art1.jpg"),
            links: [TrackLink(service: "apple_music", url: "https://music.apple.com/1", label: "Apple Music")],
            match: MatchMetadata(provider: "shazamkit", offsetMs: 42000, timecode: "00:42", confidence: nil, recognizedAt: "2026-11-12T08:00:00Z")
        )

        let v1Envelope = LibraryDatabaseEnvelopeV1(
            schemaVersion: 1,
            records: [
                .init(uuid: "item-v1-1", track: track1, isFavorite: true, recognizedAt: "2026-11-12T08:00:00Z")
            ]
        )
        let v1Data = try JSONEncoder().encode(v1Envelope)
        try v1Data.write(to: fileURL)

        let store = LibraryStore(fileURL: fileURL)
        #expect(store.activeItems.count == 1)
        #expect(store.activeItems.first?.id == "item-v1-1")
        #expect(store.activeItems.first?.favorite == true)

        let upgradedData = try Data(contentsOf: fileURL)
        let v2Decoded = try JSONDecoder().decode(LibraryDatabaseEnvelopeV2.self, from: upgradedData)
        #expect(v2Decoded.schemaVersion == 2)

        let track2 = TrackMatch(
            id: "isrc:USRC22222222",
            title: "Solar Drift",
            artists: ["Kiasmos"],
            artist: "Kiasmos",
            album: "II",
            year: 2024,
            genres: ["Ambient Techno"],
            isrc: "USRC22222222",
            match: MatchMetadata(provider: "audd", recognizedAt: "2026-11-12T09:00:00Z")
        )
        let item2 = store.addRecognizedTrack(track2, favorite: false)
        #expect(store.activeItems.count == 2)
        #expect(store.availableArtists == ["Aurora Pulse", "Kiasmos"])

        #expect(store.filterItems(searchQuery: "synthwave").count == 1)
        #expect(store.filterItems(searchQuery: "Solar").first?.track.title == "Solar Drift")
        #expect(store.filterItems(artist: "Kiasmos").count == 1)
        #expect(store.filterItems(favoritesOnly: true).count == 1)

        // Test last-write-wins merge with remote tombstone
        let remoteTombstone = LibraryItem(
            id: "item-v1-1",
            track: track1,
            favorite: true,
            createdAt: "2026-11-12T08:00:00Z",
            updatedAt: "2026-11-12T10:30:00Z",
            deleted: true
        )
        store.mergeRemoteItems([remoteTombstone], serverTime: "2026-11-12T10:31:00Z")
        #expect(store.lastServerSyncAt == "2026-11-12T10:31:00Z")
        #expect(store.activeItems.count == 1)
        #expect(store.activeItems.first?.id == item2.id)

        let exported = store.exportJSONString()
        #expect(exported.contains("Solar Drift"))

        store.deleteItem(id: item2.id)
        #expect(store.activeItems.isEmpty)
    }

    // MARK: - 5. API Client, Error Mapping, and State Machine Tests

    @MainActor
    @Test("State machine handles ShazamKit service error fallback, cancel, backgrounding, mic disconnect, and API errors")
    func testStateMachineLifecycleAndErrorMappings() async throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("auralis-sm-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tempDir) }

        let store = LibraryStore(fileURL: tempDir.appendingPathComponent("lib.json"))
        let mockTransport = MockHTTPTransport()
        let apiClient = AuralisAPIClient(
            baseURL: URL(string: "https://api.auralis.test")!,
            installId: "test-install-uuid",
            transport: mockTransport
        )
        let mockShazam = MockShazamRecognizer(
            outcome: .serviceError(.catalogUnavailable("ShazamKit entitlement unavailable in test environment"))
        )

        let sm = RecognitionStateMachine(
            libraryStore: store,
            apiClient: apiClient,
            shazamRecognizer: mockShazam
        )
        sm.providerMode = .auto

        // 1. Test too_quiet gate prevents network call
        let silentSamples = [Float](repeating: 0.0001, count: 16_000 * 5)
        await sm.processCapturedAudioAndIdentify(monoSamples: silentSamples, inputSampleRate: 16_000)
        #expect(sm.state == .tooQuiet)
        #expect(mockTransport.recordedRequests.isEmpty)

        // 2. Test normal audio with ShazamKit service error falls back to Cloud Server and matches
        let toneSamples = (0..<(16_000 * 5)).map { i in
            Float(0.4 * sin(2.0 * Double.pi * 440.0 * Double(i) / 16000.0))
        }
        await sm.processCapturedAudioAndIdentify(monoSamples: toneSamples, inputSampleRate: 16_000)

        #expect(sm.state == .matched)
        #expect(sm.matchedTrack?.title == "Cloud Fallback Song")
        #expect(mockTransport.recordedRequests.count == 1)
        let req = mockTransport.recordedRequests[0]
        #expect(req.value(forHTTPHeaderField: "X-Auralis-Client") == "ios/1.0.0")
        #expect(req.value(forHTTPHeaderField: "X-Auralis-Install") == "test-install-uuid")
        #expect(store.activeItems.count == 1)

        // 3. Test API 503 PROVIDER_QUOTA maps to .serviceUnavailable
        sm.providerMode = .auralisCloud
        mockTransport.customHandler = { request in
            let errEnvelope = APIErrorEnvelope(
                error: APIErrorDetail(code: "PROVIDER_QUOTA", message: "Daily provider quota exceeded", retryable: false)
            )
            let data = try JSONEncoder().encode(errEnvelope)
            let http = HTTPURLResponse(url: request.url!, statusCode: 503, httpVersion: "HTTP/1.1", headerFields: nil)!
            return (data, http)
        }
        await sm.processCapturedAudioAndIdentify(monoSamples: toneSamples, inputSampleRate: 16_000)
        #expect(sm.state == .serviceUnavailable)
        #expect(sm.statusMessage?.contains("Daily provider quota exceeded") == true)

        // 4. Test microphone disconnect transitions to .micUnavailable
        sm.handleMicrophoneDisconnected(message: "Bluetooth headset disconnected")
        #expect(sm.state == .micUnavailable)

        // 5. Test reset to idle
        sm.resetToIdle()
        #expect(sm.state == .idle)
    }
}

// MARK: - Test Doubles

final class MockShazamRecognizer: ShazamKitRecognizing, @unchecked Sendable {
    var outcome: ShazamKitMatchOutcome

    init(outcome: ShazamKitMatchOutcome) {
        self.outcome = outcome
    }

    func match(pcmBuffers: [AVAudioPCMBuffer], platform: String) async -> ShazamKitMatchOutcome {
        outcome
    }

    func match(monoSamples: [Float], sampleRate: Double, platform: String) async -> ShazamKitMatchOutcome {
        outcome
    }
}

final class MockHTTPTransport: AuralisHTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    var recordedRequests: [URLRequest] = []
    var customHandler: ((URLRequest) throws -> (Data, HTTPURLResponse))?

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        lock.withLock {
            recordedRequests.append(request)
        }
        if let customHandler = customHandler {
            return try customHandler(request)
        }

        let matchedTrack = TrackMatch(
            id: "isrc:USUM71703861",
            title: "Cloud Fallback Song",
            artists: ["Auralis Artist"],
            artist: "Auralis Artist",
            album: "Midnight Signals",
            releaseDate: "2025-01-15",
            year: 2025,
            genres: ["Electronic"],
            label: "Deep Blue",
            isrc: "USUM71703861",
            durationMs: 200000,
            artwork: TrackArtwork(url: "https://example.com/cover.jpg", thumbUrl: "https://example.com/thumb.jpg", width: 1000, height: 1000),
            links: [TrackLink(service: "spotify", url: "https://open.spotify.com/track/123", label: "Spotify")],
            match: MatchMetadata(
                provider: "audd",
                offsetMs: 45000,
                timecode: "00:45",
                confidence: nil,
                recognizedAt: "2026-11-12T09:45:00Z",
                source: "microphone",
                platform: "ios"
            )
        )
        let responseObj = RecognizeResponse(
            status: "match",
            requestId: "req-123",
            latencyMs: 620,
            provider: RecognizedProviderSummary(id: "audd", name: "AudD"),
            result: matchedTrack
        )
        let data = try JSONEncoder().encode(responseObj)
        let http = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (data, http)
    }
}
