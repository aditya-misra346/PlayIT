import Foundation
import AVFoundation
import Combine

// MARK: - Audio Input Device Descriptor

public struct AudioInputDevice: Identifiable, Equatable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let portType: String
    public let isDefault: Bool

    public init(id: String, name: String, portType: String, isDefault: Bool) {
        self.id = id
        self.name = name
        self.portType = portType
        self.isDefault = isDefault
    }
}

// MARK: - Live Audio Capture Manager (AVAudioEngine + AVAudioSession)

@MainActor
public final class AudioCaptureManager: ObservableObject {
    @Published public private(set) var availableInputs: [AudioInputDevice] = []
    @Published public private(set) var selectedInputId: String? = nil
    @Published public private(set) var isCapturing: Bool = false

    private var audioEngine: AVAudioEngine?
    private var captureTimer: Timer?
    private var captureStartTime: Date?
    private let sampleBufferLock = NSLock()
    private var capturedMonoSamples: [Float] = []
    private var capturedPCMBuffers: [AVAudioPCMBuffer] = []
    private var activeSampleRate: Int = 44_100

    public var onLiveLevelUpdate: ((LiveAudioLevel, Double) -> Void)?
    public var onTargetDurationReached: (([Float], Int, [AVAudioPCMBuffer]) -> Void)?
    public var onMicrophoneDisconnected: ((String) -> Void)?
    public var onAudioInterruption: ((String) -> Void)?

    private var notificationObservers: [NSObjectProtocol] = []

    public init() {
        refreshAvailableInputs()
        setupAudioSessionNotifications()
    }

    deinit {
        for observer in notificationObservers {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    // MARK: - Microphone Permission

    public func requestMicrophonePermission() async -> Bool {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            return await AVAudioApplication.requestRecordPermission()
        } else {
            return await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }
        #elseif os(macOS)
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        case .denied, .restricted:
            return false
        @unknown default:
            return false
        }
        #else
        return false
        #endif
    }

    // MARK: - Input Device Enumeration & Selection

    public func refreshAvailableInputs() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        let currentUid = session.preferredInput?.uid ?? session.currentRoute.inputs.first?.uid
        let inputs = session.availableInputs ?? []
        self.availableInputs = inputs.map { desc in
            AudioInputDevice(
                id: desc.uid,
                name: desc.portName,
                portType: desc.portType.rawValue,
                isDefault: desc.uid == currentUid
            )
        }
        if selectedInputId == nil {
            selectedInputId = currentUid ?? availableInputs.first?.id
        }
        #else
        self.availableInputs = [
            AudioInputDevice(
                id: "default-mic",
                name: "Built-in Microphone",
                portType: "MicrophoneBuiltIn",
                isDefault: true
            )
        ]
        if selectedInputId == nil {
            selectedInputId = "default-mic"
        }
        #endif
    }

    public func selectPreferredInput(deviceId: String?) throws {
        selectedInputId = deviceId
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        if let deviceId = deviceId,
           let match = session.availableInputs?.first(where: { $0.uid == deviceId }) {
            try session.setPreferredInput(match)
        } else {
            try session.setPreferredInput(nil)
        }
        refreshAvailableInputs()
        #endif
    }

    // MARK: - Configure Measurement Audio Session (No Voice Processing)

    private func configureAudioSessionForMusicMeasurement() throws {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        // Category .playAndRecord with mode .measurement disables voice processing (AGC, noise suppression, echo cancellation)
        try session.setCategory(
            .playAndRecord,
            mode: .measurement,
            options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]
        )
        try session.setPreferredSampleRate(48_000)
        try session.setPreferredIOBufferDuration(0.02)
        if let selectedId = selectedInputId,
           let match = session.availableInputs?.first(where: { $0.uid == selectedId }) {
            try? session.setPreferredInput(match)
        }
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        refreshAvailableInputs()
        #endif
    }

    // MARK: - Start / Stop Capture

    public func startCapture() throws {
        stopCaptureInternal(deactivateSession: false)

        try configureAudioSessionForMusicMeasurement()

        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        #if os(iOS)
        if #available(iOS 13.0, *) {
            // Ensure voice processing is disabled on the input node
            if inputNode.isVoiceProcessingEnabled {
                try? inputNode.setVoiceProcessingEnabled(false)
            }
        }
        #endif

        let hwFormat = inputNode.outputFormat(forBus: 0)
        guard hwFormat.sampleRate > 0, hwFormat.channelCount > 0 else {
            throw NSError(
                domain: "AuralisAudio",
                code: -10,
                userInfo: [NSLocalizedDescriptionKey: "No active microphone input route is available."]
            )
        }

        let sampleRateInt = Int(hwFormat.sampleRate.rounded())
        let maxSamples = sampleRateInt * Int(AudioDSP.maxDurationSeconds)

        sampleBufferLock.lock()
        capturedMonoSamples.removeAll(keepingCapacity: true)
        capturedMonoSamples.reserveCapacity(sampleRateInt * Int(AudioDSP.targetDurationSeconds))
        capturedPCMBuffers.removeAll(keepingCapacity: true)
        activeSampleRate = sampleRateInt
        sampleBufferLock.unlock()

        let startDate = Date()
        self.captureStartTime = startDate

        inputNode.installTap(onBus: 0, bufferSize: 2048, format: hwFormat) { [weak self] buffer, _ in
            guard let self = self else { return }
            let monoChunk = AudioDSP.extractMonoSamples(from: buffer)
            guard !monoChunk.isEmpty else { return }

            let copiedBuffer = Self.copyPCMBuffer(buffer)

            self.sampleBufferLock.lock()
            let remaining = maxSamples - self.capturedMonoSamples.count
            if remaining > 0 {
                if monoChunk.count <= remaining {
                    self.capturedMonoSamples.append(contentsOf: monoChunk)
                } else {
                    self.capturedMonoSamples.append(contentsOf: monoChunk.prefix(remaining))
                }
            }
            if let copiedBuffer = copiedBuffer {
                self.capturedPCMBuffers.append(copiedBuffer)
            }
            let recentTail = Array(self.capturedMonoSamples.suffix(max(1, Int(hwFormat.sampleRate * 0.06))))
            self.sampleBufferLock.unlock()

            let level = AudioDSP.computeLiveLevel(samples: recentTail, sampleRate: hwFormat.sampleRate)
            let elapsed = Date().timeIntervalSince(startDate)

            Task { @MainActor [weak self] in
                guard let self = self, self.isCapturing else { return }
                self.onLiveLevelUpdate?(level, elapsed)
                if elapsed >= AudioDSP.targetDurationSeconds {
                    self.finishCaptureAtTargetDuration()
                }
            }
        }

        engine.prepare()
        try engine.start()

        self.audioEngine = engine
        self.isCapturing = true
    }

    /// Stops capture immediately and returns `(monoSamples, sampleRate, pcmBuffers)`.
    @discardableResult
    public func stopCapture(cancel: Bool) -> (samples: [Float], sampleRate: Int, buffers: [AVAudioPCMBuffer]) {
        stopCaptureInternal(deactivateSession: true)
        sampleBufferLock.lock()
        let samples = cancel ? [] : capturedMonoSamples
        let rate = activeSampleRate
        let buffers = cancel ? [] : capturedPCMBuffers
        capturedMonoSamples.removeAll()
        capturedPCMBuffers.removeAll()
        sampleBufferLock.unlock()
        return (samples, rate, buffers)
    }

    private func finishCaptureAtTargetDuration() {
        guard isCapturing else { return }
        let captured = stopCapture(cancel: false)
        onTargetDurationReached?(captured.samples, captured.sampleRate, captured.buffers)
    }

    private func stopCaptureInternal(deactivateSession: Bool) {
        captureTimer?.invalidate()
        captureTimer = nil
        captureStartTime = nil
        if let engine = audioEngine {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
        }
        audioEngine = nil
        isCapturing = false
        #if os(iOS)
        if deactivateSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
        #endif
    }

    // MARK: - Audio Session Interruption & Route Change Notifications

    private func setupAudioSessionNotifications() {
        #if os(iOS)
        let nc = NotificationCenter.default
        let interruptionObserver = nc.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            guard let userInfo = notification.userInfo,
                  let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
                return
            }
            if type == .began {
                Task { @MainActor [weak self] in
                    guard let self = self, self.isCapturing else { return }
                    _ = self.stopCapture(cancel: true)
                    self.onAudioInterruption?("Audio capture was interrupted by another app or phone call.")
                }
            }
        }

        let routeChangeObserver = nc.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] notification in
            let reasonValue = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt
            let reason = reasonValue.flatMap { AVAudioSession.RouteChangeReason(rawValue: $0) }
            Task { @MainActor [weak self] in
                guard let self = self else { return }
                self.refreshAvailableInputs()
                let hasInput = !(AVAudioSession.sharedInstance().currentRoute.inputs.isEmpty)
                if self.isCapturing && (reason == .oldDeviceUnavailable || !hasInput) {
                    _ = self.stopCapture(cancel: true)
                    self.onMicrophoneDisconnected?("The selected microphone was disconnected during listening.")
                }
            }
        }

        notificationObservers.append(contentsOf: [interruptionObserver, routeChangeObserver])
        #endif
    }

    private static func copyPCMBuffer(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
            return nil
        }
        copy.frameLength = buffer.frameLength
        let frameLen = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        if let srcFloats = buffer.floatChannelData, let dstFloats = copy.floatChannelData {
            if buffer.format.isInterleaved {
                dstFloats[0].update(from: srcFloats[0], count: frameLen * channels)
            } else {
                for ch in 0..<channels {
                    dstFloats[ch].update(from: srcFloats[ch], count: frameLen)
                }
            }
            return copy
        }
        return nil
    }
}
