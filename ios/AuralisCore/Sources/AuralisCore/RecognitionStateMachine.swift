import Foundation
import AVFoundation
import Combine

@MainActor
public final class RecognitionStateMachine: ObservableObject {
    public static let providerModeDefaultsKey = "com.auralis.ios.provider_mode"
    public static let serverURLDefaultsKey = "com.auralis.ios.server_base_url"
    public static let authTokenDefaultsKey = "com.auralis.ios.auth_token"
    public static let authUserEmailDefaultsKey = "com.auralis.ios.auth_user_email"
    public static let authUserIdDefaultsKey = "com.auralis.ios.auth_user_id"

    @Published public private(set) var state: RecognitionState = .idle
    @Published public private(set) var matchedTrack: TrackMatch? = nil
    @Published public private(set) var liveLevel: LiveAudioLevel = .zero
    @Published public private(set) var elapsedSeconds: Double = 0.0
    @Published public private(set) var clippingWarning: String? = nil
    @Published public private(set) var statusMessage: String? = nil
    @Published public private(set) var lastQualityMetrics: AudioQualityMetrics? = nil

    @Published public var providerMode: RecognitionProviderMode {
        didSet {
            userDefaults.set(providerMode.rawValue, forKey: Self.providerModeDefaultsKey)
        }
    }

    @Published public var serverBaseURLString: String {
        didSet {
            userDefaults.set(serverBaseURLString, forKey: Self.serverURLDefaultsKey)
            if let url = URL(string: serverBaseURLString.trimmingCharacters(in: .whitespacesAndNewlines)) {
                apiClient.baseURL = url
            }
        }
    }

    @Published public private(set) var signedInUser: AuthUser? = nil
    @Published public private(set) var isSyncingAccount: Bool = false
    @Published public private(set) var accountErrorMessage: String? = nil

    public let libraryStore: LibraryStore
    public let apiClient: AuralisAPIClient
    public let audioCaptureManager: AudioCaptureManager
    private let shazamRecognizer: ShazamKitRecognizing
    private let userDefaults: UserDefaults
    private var activeRecognitionTask: Task<Void, Never>?

    public init(
        libraryStore: LibraryStore? = nil,
        apiClient: AuralisAPIClient? = nil,
        audioCaptureManager: AudioCaptureManager? = nil,
        shazamRecognizer: ShazamKitRecognizing = AppleShazamKitRecognizer(),
        userDefaults: UserDefaults = .standard
    ) {
        self.userDefaults = userDefaults
        self.libraryStore = libraryStore ?? LibraryStore()
        self.shazamRecognizer = shazamRecognizer

        let savedModeRaw = userDefaults.string(forKey: Self.providerModeDefaultsKey)
        self.providerMode = savedModeRaw.flatMap(RecognitionProviderMode.init(rawValue:)) ?? .auto

        let savedURL = userDefaults.string(forKey: Self.serverURLDefaultsKey) ?? AuralisAPIClient.defaultBaseURLString
        self.serverBaseURLString = savedURL

        let resolvedURL = URL(string: savedURL) ?? URL(string: AuralisAPIClient.defaultBaseURLString)!
        let savedToken = userDefaults.string(forKey: Self.authTokenDefaultsKey)
        self.apiClient = apiClient ?? AuralisAPIClient(baseURL: resolvedURL, sessionToken: savedToken)
        self.audioCaptureManager = audioCaptureManager ?? AudioCaptureManager()

        if let token = savedToken, !token.isEmpty,
           let email = userDefaults.string(forKey: Self.authUserEmailDefaultsKey),
           let uid = userDefaults.string(forKey: Self.authUserIdDefaultsKey) {
            self.signedInUser = AuthUser(id: uid, email: email)
            self.apiClient.sessionToken = token
        }

        wireAudioCaptureCallbacks()
    }

    private func wireAudioCaptureCallbacks() {
        audioCaptureManager.onLiveLevelUpdate = { [weak self] level, elapsed in
            guard let self = self, self.state == .listening else { return }
            self.liveLevel = level
            self.elapsedSeconds = min(elapsed, AudioDSP.targetDurationSeconds)
        }

        audioCaptureManager.onTargetDurationReached = { [weak self] samples, sampleRate, buffers in
            guard let self = self, self.state == .listening else { return }
            self.activeRecognitionTask = Task { @MainActor [weak self] in
                await self?.processCapturedAudioAndIdentify(
                    monoSamples: samples,
                    inputSampleRate: sampleRate,
                    pcmBuffers: buffers
                )
            }
        }

        audioCaptureManager.onMicrophoneDisconnected = { [weak self] message in
            self?.handleMicrophoneDisconnected(message: message)
        }

        audioCaptureManager.onAudioInterruption = { [weak self] message in
            self?.handleAudioInterruption(message: message)
        }
    }

    // MARK: - Live Capture Actions

    public func startListeningFlow(customPermissionProvider: (() async -> Bool)? = nil) {
        activeRecognitionTask?.cancel()
        matchedTrack = nil
        clippingWarning = nil
        statusMessage = nil
        liveLevel = .zero
        elapsedSeconds = 0.0
        state = .requestingPermission

        activeRecognitionTask = Task { @MainActor [weak self] in
            guard let self = self else { return }
            let granted: Bool
            if let customPermissionProvider = customPermissionProvider {
                granted = await customPermissionProvider()
            } else {
                granted = await self.audioCaptureManager.requestMicrophonePermission()
            }
            guard !Task.isCancelled else { return }
            if !granted {
                self.state = .micUnavailable
                self.statusMessage = "Microphone permission was denied. Enable Microphone access in iOS Settings to identify music."
                return
            }

            do {
                try self.audioCaptureManager.startCapture()
                self.state = .listening
                self.statusMessage = RecognitionState.listening.defaultSubtitle
            } catch {
                self.state = .micUnavailable
                self.statusMessage = error.localizedDescription
            }
        }
    }

    /// Manually stops listening early (if >= 4s) and analyzes the captured sample.
    public func finishListeningEarlyAndIdentify() {
        guard state == .listening else { return }
        let captured = audioCaptureManager.stopCapture(cancel: false)
        activeRecognitionTask?.cancel()
        activeRecognitionTask = Task { @MainActor [weak self] in
            await self?.processCapturedAudioAndIdentify(
                monoSamples: captured.samples,
                inputSampleRate: captured.sampleRate,
                pcmBuffers: captured.buffers
            )
        }
    }

    /// Instant cancel button handler: stops capture immediately and returns to `idle`.
    public func cancelListening() {
        activeRecognitionTask?.cancel()
        activeRecognitionTask = nil
        _ = audioCaptureManager.stopCapture(cancel: true)
        liveLevel = .zero
        elapsedSeconds = 0.0
        clippingWarning = nil
        statusMessage = nil
        state = .idle
    }

    /// Stops capture immediately when the app enters background (`scenePhase == .background`).
    public func handleSceneBackgrounded() {
        if state.isActiveCaptureOrProcessing {
            cancelListening()
        }
    }

    public func handleMicrophoneDisconnected(message: String = "Microphone disconnected during listening.") {
        activeRecognitionTask?.cancel()
        activeRecognitionTask = nil
        _ = audioCaptureManager.stopCapture(cancel: true)
        liveLevel = .zero
        state = .micUnavailable
        statusMessage = message
    }

    public func handleAudioInterruption(message: String = "Audio session was interrupted.") {
        activeRecognitionTask?.cancel()
        activeRecognitionTask = nil
        _ = audioCaptureManager.stopCapture(cancel: true)
        liveLevel = .zero
        state = .micUnavailable
        statusMessage = message
    }

    public func resetToIdle() {
        cancelListening()
        matchedTrack = nil
        lastQualityMetrics = nil
    }

    // MARK: - Core Quality Gate + Provider Execution Pipeline

    public func processCapturedAudioAndIdentify(
        monoSamples: [Float],
        inputSampleRate: Int,
        pcmBuffers: [AVAudioPCMBuffer] = []
    ) async {
        liveLevel = .zero
        state = .analyzing
        statusMessage = RecognitionState.analyzing.defaultSubtitle

        guard inputSampleRate > 0, !monoSamples.isEmpty else {
            state = .tooQuiet
            statusMessage = AudioDSP.tooQuietMessage
            return
        }

        let durationSeconds = Double(monoSamples.count) / Double(inputSampleRate)
        if durationSeconds < AudioDSP.minDurationSeconds {
            state = .tooQuiet
            statusMessage = "Sample too short (\(String(format: "%.1f", durationSeconds))s — minimum 4s required)."
            return
        }

        // Trim to maxDurationSeconds (12s) if longer
        let maxSamples = inputSampleRate * Int(AudioDSP.maxDurationSeconds)
        let boundedSamples = monoSamples.count > maxSamples ? Array(monoSamples.prefix(maxSamples)) : monoSamples

        let processed = AudioDSP.processCapturedMonoSamples(boundedSamples, inputSampleRate: inputSampleRate)
        self.lastQualityMetrics = processed.metrics

        switch processed.verdict {
        case .tooQuiet(let message):
            // Per CONTRACT.md: do NOT upload when too_quiet
            self.clippingWarning = nil
            self.state = .tooQuiet
            self.statusMessage = message
            return
        case .passedWithClippingWarning(let hint):
            self.clippingWarning = hint
        case .passed:
            self.clippingWarning = nil
        }

        guard !Task.isCancelled else { return }
        self.state = .identifying
        self.statusMessage = RecognitionState.identifying.defaultSubtitle

        switch providerMode {
        case .shazamKit:
            await identifyWithShazamKitOnly(
                pcmBuffers: pcmBuffers,
                monoSamples: boundedSamples,
                sampleRate: Double(inputSampleRate)
            )
        case .auralisCloud:
            await identifyWithCloudServer(processed: processed)
        case .auto:
            await identifyWithAutoFallback(
                pcmBuffers: pcmBuffers,
                monoSamples: boundedSamples,
                sampleRate: Double(inputSampleRate),
                processed: processed
            )
        }
    }

    private func identifyWithShazamKitOnly(
        pcmBuffers: [AVAudioPCMBuffer],
        monoSamples: [Float],
        sampleRate: Double
    ) async {
        let outcome: ShazamKitMatchOutcome
        if !pcmBuffers.isEmpty {
            outcome = await shazamRecognizer.match(pcmBuffers: pcmBuffers, platform: "ios")
        } else {
            outcome = await shazamRecognizer.match(monoSamples: monoSamples, sampleRate: sampleRate, platform: "ios")
        }
        guard !Task.isCancelled else { return }

        switch outcome {
        case .matched(let track):
            completeWithMatch(track)
        case .noMatch:
            state = .noMatch
            statusMessage = RecognitionState.noMatch.defaultSubtitle
        case .serviceError(let error):
            state = .serviceUnavailable
            statusMessage = error.localizedDescription
        }
    }

    private func identifyWithAutoFallback(
        pcmBuffers: [AVAudioPCMBuffer],
        monoSamples: [Float],
        sampleRate: Double,
        processed: ProcessedAudioPayload
    ) async {
        let outcome: ShazamKitMatchOutcome
        if !pcmBuffers.isEmpty {
            outcome = await shazamRecognizer.match(pcmBuffers: pcmBuffers, platform: "ios")
        } else {
            outcome = await shazamRecognizer.match(monoSamples: monoSamples, sampleRate: sampleRate, platform: "ios")
        }
        guard !Task.isCancelled else { return }

        switch outcome {
        case .matched(let track):
            completeWithMatch(track)
        case .noMatch:
            state = .noMatch
            statusMessage = RecognitionState.noMatch.defaultSubtitle
        case .serviceError:
            // Fallback to Auralis Cloud Server on ShazamKit service error
            statusMessage = "ShazamKit unavailable — falling back to Auralis Cloud Server…"
            await identifyWithCloudServer(processed: processed)
        }
    }

    private func identifyWithCloudServer(processed: ProcessedAudioPayload) async {
        do {
            let response = try await apiClient.recognizeAudio(
                wavData: processed.wavData,
                source: "microphone",
                durationMs: processed.durationMs
            )
            guard !Task.isCancelled else { return }
            if response.status == "match", let track = response.result {
                completeWithMatch(track)
            } else {
                state = .noMatch
                statusMessage = RecognitionState.noMatch.defaultSubtitle
            }
        } catch let clientError as AuralisClientError {
            guard !Task.isCancelled else { return }
            state = clientError.mappedRecognitionState
            statusMessage = clientError.localizedDescription
        } catch {
            guard !Task.isCancelled else { return }
            state = .connectionError
            statusMessage = error.localizedDescription
        }
    }

    private func completeWithMatch(_ track: TrackMatch) {
        self.matchedTrack = track
        self.state = .matched
        self.statusMessage = "Identified via \(track.match.providerDisplayName)"
        self.libraryStore.addRecognizedTrack(track)
    }

    // MARK: - Optional Accounts & Cloud Sync

    public func registerAccount(email: String, password: String) async throws {
        isSyncingAccount = true
        accountErrorMessage = nil
        defer { isSyncingAccount = false }
        do {
            let auth = try await apiClient.register(email: email, password: password)
            persistSignedInUser(auth)
            try await syncLibraryWithCloud()
        } catch {
            accountErrorMessage = error.localizedDescription
            throw error
        }
    }

    public func loginAccount(email: String, password: String) async throws {
        isSyncingAccount = true
        accountErrorMessage = nil
        defer { isSyncingAccount = false }
        do {
            let auth = try await apiClient.login(email: email, password: password)
            persistSignedInUser(auth)
            try await syncLibraryWithCloud()
        } catch {
            accountErrorMessage = error.localizedDescription
            throw error
        }
    }

    public func syncLibraryWithCloud() async throws {
        guard signedInUser != nil else { return }
        isSyncingAccount = true
        accountErrorMessage = nil
        defer { isSyncingAccount = false }
        do {
            let syncResp = try await apiClient.syncLibrary(items: libraryStore.allItemsIncludingTombstones)
            libraryStore.mergeRemoteItems(syncResp.items, serverTime: syncResp.serverTime)
        } catch {
            accountErrorMessage = error.localizedDescription
            throw error
        }
    }

    public func logoutAccount() {
        signedInUser = nil
        apiClient.sessionToken = nil
        accountErrorMessage = nil
        userDefaults.removeObject(forKey: Self.authTokenDefaultsKey)
        userDefaults.removeObject(forKey: Self.authUserEmailDefaultsKey)
        userDefaults.removeObject(forKey: Self.authUserIdDefaultsKey)
    }

    public func deleteCloudAccount() async throws {
        isSyncingAccount = true
        accountErrorMessage = nil
        defer { isSyncingAccount = false }
        do {
            try await apiClient.deleteAccount()
            logoutAccount()
            libraryStore.clearAll(keepTombstonesForSync: false)
        } catch {
            accountErrorMessage = error.localizedDescription
            throw error
        }
    }

    private func persistSignedInUser(_ auth: AuthResponse) {
        signedInUser = auth.user
        apiClient.sessionToken = auth.token
        userDefaults.set(auth.token, forKey: Self.authTokenDefaultsKey)
        userDefaults.set(auth.user.email, forKey: Self.authUserEmailDefaultsKey)
        userDefaults.set(auth.user.id, forKey: Self.authUserIdDefaultsKey)
    }
}
