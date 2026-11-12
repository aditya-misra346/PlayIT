import SwiftUI
import AuralisCore

public struct ListenView: View {
    @ObservedObject public var stateMachine: RecognitionStateMachine
    @ObservedObject private var captureManager: AudioCaptureManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    public var onOpenResult: (TrackMatch) -> Void

    public init(
        stateMachine: RecognitionStateMachine,
        onOpenResult: @escaping (TrackMatch) -> Void
    ) {
        self.stateMachine = stateMachine
        self._captureManager = ObservedObject(wrappedValue: stateMachine.audioCaptureManager)
        self.onOpenResult = onOpenResult
    }

    public var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                headerBar

                if stateMachine.state == .listening {
                    recordingIndicatorBanner
                }

                if let clippingHint = stateMachine.clippingWarning {
                    clippingWarningBanner(hint: clippingHint)
                }

                Spacer(minLength: 10)

                listenOrbButtonSection

                stateStatusCard

                if stateMachine.state.isActiveCaptureOrProcessing {
                    activeCaptureControlButtons
                }

                microphonePickerAndSandboxNoticeCard

                CreatorFooterView()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .background(AuralisBrand.backgroundGradient.ignoresSafeArea())
        .navigationTitle("")
        #if os(iOS)
        .navigationBarHidden(true)
        #endif
    }

    // MARK: - Brand Header

    private var headerBar: some View {
        HStack(alignment: .center, spacing: 12) {
            AuralisBrandMarkView(size: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(AuralisBrand.productName)
                    .font(.system(size: 24, weight: .bold, design: .default))
                    .tracking(-0.5)
                    .foregroundStyle(AuralisBrand.primaryText)

                Text(AuralisBrand.tagline)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(AuralisBrand.mutedText)
            }

            Spacer()

            HStack(spacing: 6) {
                Image(systemName: providerIconName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AuralisBrand.cyan)
                Text(shortProviderLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AuralisBrand.primaryText)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                Capsule()
                    .fill(AuralisBrand.charcoalElevated)
                    .overlay(
                        Capsule()
                            .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                    )
            )
        }
    }

    private var providerIconName: String {
        switch stateMachine.providerMode {
        case .shazamKit:
            return "waveform.badge.magnifyingglass"
        case .auralisCloud:
            return "cloud.fill"
        case .auto:
            return "sparkles"
        }
    }

    private var shortProviderLabel: String {
        switch stateMachine.providerMode {
        case .shazamKit:
            return "ShazamKit"
        case .auralisCloud:
            return "Auralis Cloud"
        case .auto:
            return "Auto (ShazamKit + Cloud)"
        }
    }

    // MARK: - Recording Indicator Banner

    private var recordingIndicatorBanner: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(AuralisBrand.danger)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)

            Text("REC")
                .font(.caption.weight(.heavy))
                .foregroundStyle(AuralisBrand.danger)

            Text(formattedCountdownText)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(AuralisBrand.primaryText)

            Spacer()

            Text(formattedDbfsText)
                .font(.caption2.monospacedDigit())
                .foregroundStyle(AuralisBrand.mutedText)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(AuralisBrand.deepSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(AuralisBrand.danger.opacity(0.45), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Recording microphone audio, \(Int(stateMachine.elapsedSeconds)) of 10 seconds elapsed")
    }

    private var formattedCountdownText: String {
        let elapsed = Int(stateMachine.elapsedSeconds.rounded(.down))
        let target = Int(AudioDSP.targetDurationSeconds)
        return String(format: "00:%02d / 00:%02d", min(elapsed, target), target)
    }

    private var formattedDbfsText: String {
        let dbfs = stateMachine.liveLevel.rmsDbfs
        if dbfs <= -90 {
            return "-∞ dBFS"
        }
        return String(format: "%.1f dBFS", dbfs)
    }

    // MARK: - Clipping Warning Banner

    private func clippingWarningBanner(hint: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(AuralisBrand.warning)
            Text(hint)
                .font(.footnote.weight(.medium))
                .foregroundStyle(AuralisBrand.primaryText)
            Spacer()
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(AuralisBrand.warning.opacity(0.14))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(AuralisBrand.warning.opacity(0.6), lineWidth: 1)
                )
        )
    }

    // MARK: - Concentric Audio-Reactive Listen Button

    private var listenOrbButtonSection: some View {
        let level = CGFloat(stateMachine.liveLevel.rmsNormalized) // 0.0 ... 1.0
        let isListening = stateMachine.state == .listening
        let isProcessing = stateMachine.state == .analyzing || stateMachine.state == .identifying

        return ZStack {
            // Outer Concentric Ring 3
            Circle()
                .strokeBorder(
                    AuralisBrand.teal.opacity(isListening ? Double(0.18 + 0.45 * level) : 0.10),
                    lineWidth: isListening ? (2.0 + 4.0 * level) : 1.5
                )
                .frame(
                    width: reduceMotion ? 286 : (250 + (isListening ? 62 * level : 0)),
                    height: reduceMotion ? 286 : (250 + (isListening ? 62 * level : 0))
                )

            // Middle Concentric Ring 2
            Circle()
                .strokeBorder(
                    AuralisBrand.cyan.opacity(isListening ? Double(0.28 + 0.50 * level) : 0.16),
                    lineWidth: isListening ? (2.5 + 5.0 * level) : 2.0
                )
                .frame(
                    width: reduceMotion ? 248 : (220 + (isListening ? 42 * level : 0)),
                    height: reduceMotion ? 248 : (220 + (isListening ? 42 * level : 0))
                )

            // Inner Concentric Ring 1
            Circle()
                .strokeBorder(
                    AuralisBrand.electricBlue.opacity(isListening ? Double(0.40 + 0.55 * level) : 0.25),
                    lineWidth: isListening ? (3.0 + 6.0 * level) : 2.5
                )
                .frame(
                    width: reduceMotion ? 214 : (194 + (isListening ? 24 * level : 0)),
                    height: reduceMotion ? 214 : (194 + (isListening ? 24 * level : 0))
                )

            // Main Circular Listen Button
            Button {
                handlePrimaryOrbTap()
            } label: {
                ZStack {
                    Circle()
                        .fill(AuralisBrand.signatureGradient)
                        .frame(width: 172, height: 172)
                        .shadow(
                            color: AuralisBrand.cyan.opacity(isListening ? Double(0.35 + 0.40 * level) : 0.22),
                            radius: isListening ? 28 : 16,
                            x: 0,
                            y: 6
                        )

                    VStack(spacing: 10) {
                        if isProcessing {
                            ProgressView()
                                .tint(AuralisBrand.midnightBg)
                                .scaleEffect(1.35)
                        } else {
                            AuralisBrandMarkView(
                                size: 58,
                                foregroundColor: AuralisBrand.midnightBg
                            )
                        }

                        Text(orbActionLabel)
                            .font(.system(size: 16, weight: .bold))
                            .tracking(-0.2)
                            .foregroundStyle(AuralisBrand.midnightBg)
                    }
                }
                .scaleEffect(reduceMotion ? 1.0 : (isListening ? (1.0 + 0.05 * level) : 1.0))
                .animation(
                    reduceMotion ? nil : .spring(response: 0.18, dampingFraction: 0.68),
                    value: level
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(orbAccessibilityLabel)
            .accessibilityHint("Tap to start or stop music identification")
        }
        .frame(height: 310)
    }

    private var orbActionLabel: String {
        switch stateMachine.state {
        case .idle, .noMatch, .micUnavailable, .connectionError, .serviceUnavailable, .tooQuiet, .matched:
            return "Tap to Identify"
        case .requestingPermission:
            return "Grant Access…"
        case .listening:
            return "Listening…"
        case .analyzing:
            return "Analyzing…"
        case .identifying:
            return "Identifying…"
        }
    }

    private var orbAccessibilityLabel: String {
        "\(AuralisBrand.productName) Listen Button — \(stateMachine.state.displayTitle)"
    }

    private func handlePrimaryOrbTap() {
        switch stateMachine.state {
        case .listening:
            if stateMachine.elapsedSeconds >= AudioDSP.minDurationSeconds {
                stateMachine.finishListeningEarlyAndIdentify()
            } else {
                stateMachine.cancelListening()
            }
        case .requestingPermission, .analyzing, .identifying:
            stateMachine.cancelListening()
        default:
            stateMachine.startListeningFlow()
        }
    }

    // MARK: - Active Capture Controls (Early Identify + Instant Cancel)

    private var activeCaptureControlButtons: some View {
        HStack(spacing: 14) {
            if stateMachine.state == .listening && stateMachine.elapsedSeconds >= AudioDSP.minDurationSeconds {
                Button {
                    stateMachine.finishListeningEarlyAndIdentify()
                } label: {
                    Label("Identify Now", systemImage: "sparkle.magnifyingglass")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AuralisBrand.midnightBg)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 11)
                        .background(Capsule().fill(AuralisBrand.cyan))
                }
                .buttonStyle(.plain)
            }

            Button {
                stateMachine.cancelListening()
            } label: {
                Label("Cancel", systemImage: "xmark.circle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AuralisBrand.danger)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(
                        Capsule()
                            .fill(AuralisBrand.charcoalElevated)
                            .overlay(
                                Capsule()
                                    .strokeBorder(AuralisBrand.danger.opacity(0.5), lineWidth: 1)
                            )
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel music recognition immediately")
        }
    }

    // MARK: - Recognition State Card

    private var stateStatusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: statusIconName)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(statusAccentColor)

                Text(stateMachine.state.displayTitle)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(AuralisBrand.primaryText)

                Spacer()

                Text(stateMachine.state.rawValue)
                    .font(.caption2.monospaced())
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(AuralisBrand.midnightBg)
                    )
                    .foregroundStyle(AuralisBrand.mutedText)
            }

            Text(stateMachine.statusMessage ?? stateMachine.state.defaultSubtitle)
                .font(.subheadline)
                .foregroundStyle(AuralisBrand.mutedText)
                .fixedSize(horizontal: false, vertical: true)

            if stateMachine.state == .matched, let track = stateMachine.matchedTrack {
                Divider()
                    .overlay(AuralisBrand.lineBorder)

                Button {
                    onOpenResult(track)
                } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(track.title)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(AuralisBrand.primaryText)
                            Text(track.artist)
                                .font(.subheadline)
                                .foregroundStyle(AuralisBrand.cyan)
                        }
                        Spacer()
                        Label("View Match", systemImage: "arrow.up.right.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AuralisBrand.teal)
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(AuralisBrand.charcoalElevated)
                    )
                }
                .buttonStyle(.plain)
            } else if shouldShowTryAgainButton {
                HStack(spacing: 12) {
                    Button {
                        stateMachine.startListeningFlow()
                    } label: {
                        Label("Try Again", systemImage: "arrow.clockwise")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(AuralisBrand.midnightBg)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 9)
                            .background(Capsule().fill(AuralisBrand.cyan))
                    }
                    .buttonStyle(.plain)

                    Button {
                        stateMachine.resetToIdle()
                    } label: {
                        Text("Dismiss")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AuralisBrand.mutedText)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(AuralisBrand.deepSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: 16)
                        .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                )
        )
    }

    private var shouldShowTryAgainButton: Bool {
        switch stateMachine.state {
        case .noMatch, .micUnavailable, .connectionError, .serviceUnavailable, .tooQuiet:
            return true
        default:
            return false
        }
    }

    private var statusIconName: String {
        switch stateMachine.state {
        case .idle:
            return "waveform"
        case .requestingPermission:
            return "mic.badge.plus"
        case .listening:
            return "ear.and.waveform"
        case .analyzing:
            return "waveform.path.ecg"
        case .identifying:
            return "sparkle.magnifyingglass"
        case .matched:
            return "checkmark.seal.fill"
        case .noMatch:
            return "questionmark.circle.fill"
        case .micUnavailable:
            return "mic.slash.fill"
        case .connectionError:
            return "wifi.exclamationmark"
        case .serviceUnavailable:
            return "exclamationmark.icloud.fill"
        case .tooQuiet:
            return "speaker.slash.fill"
        }
    }

    private var statusAccentColor: Color {
        switch stateMachine.state {
        case .idle, .requestingPermission, .listening, .analyzing, .identifying:
            return AuralisBrand.cyan
        case .matched:
            return AuralisBrand.teal
        case .noMatch, .tooQuiet:
            return AuralisBrand.warning
        case .micUnavailable, .connectionError, .serviceUnavailable:
            return AuralisBrand.danger
        }
    }

    // MARK: - Microphone Picker & iOS Sandboxing Notice

    private var microphonePickerAndSandboxNoticeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Microphone Input", systemImage: "mic.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(AuralisBrand.primaryText)

                Spacer()

                Menu {
                    ForEach(captureManager.availableInputs) { input in
                        Button {
                            try? captureManager.selectPreferredInput(deviceId: input.id)
                        } label: {
                            HStack {
                                Text(input.name)
                                if captureManager.selectedInputId == input.id || (captureManager.selectedInputId == nil && input.isDefault) {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                    Divider()
                    Button("Refresh Audio Inputs") {
                        captureManager.refreshAvailableInputs()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Text(selectedMicrophoneName)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(AuralisBrand.cyan)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption2)
                            .foregroundStyle(AuralisBrand.cyan)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(AuralisBrand.charcoalElevated)
                    )
                }
            }

            Text("iOS/iPadOS sandboxing does not allow apps to capture internal system audio from other apps. Auralis listens to acoustic audio through your selected microphone in raw measurement mode (voice processing disabled) and automatically stops if backgrounded.")
                .font(.caption)
                .foregroundStyle(AuralisBrand.mutedText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(AuralisBrand.deepSurface)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                )
        )
    }

    private var selectedMicrophoneName: String {
        if let selectedId = captureManager.selectedInputId,
           let match = captureManager.availableInputs.first(where: { $0.id == selectedId }) {
            return match.name
        }
        return captureManager.availableInputs.first?.name ?? "System Default Mic"
    }
}

// MARK: - Auralis Brand Mark (Filled Circle + 3 Concentric Partially Open Arcs Offset Right)

public struct AuralisBrandMarkView: View {
    public var size: CGFloat
    public var foregroundColor: Color?

    public init(size: CGFloat = 40, foregroundColor: Color? = nil) {
        self.size = size
        self.foregroundColor = foregroundColor
    }

    public var body: some View {
        Canvas { context, canvasSize in
            let resolvedColor = foregroundColor ?? AuralisBrand.cyan

            var playPath = Path()
            playPath.move(to: CGPoint(x: canvasSize.width * 0.22, y: canvasSize.height * 0.28))
            playPath.addLine(to: CGPoint(x: canvasSize.width * 0.50, y: canvasSize.height * 0.50))
            playPath.addLine(to: CGPoint(x: canvasSize.width * 0.22, y: canvasSize.height * 0.72))
            playPath.closeSubpath()
            context.fill(playPath, with: .color(resolvedColor))

            let arcCenter = CGPoint(x: canvasSize.width * 0.38, y: canvasSize.height * 0.5)
            let radii: [CGFloat] = [
                canvasSize.width * 0.26,
                canvasSize.width * 0.38,
                canvasSize.width * 0.50
            ]
            let strokeWidth = max(2.0, canvasSize.width * 0.065)

            for (idx, r) in radii.enumerated() {
                var arc = Path()
                let angleSpan = Double(42 + idx * 6)
                arc.addArc(
                    center: arcCenter,
                    radius: r,
                    startAngle: .degrees(-angleSpan),
                    endAngle: .degrees(angleSpan),
                    clockwise: false
                )
                context.stroke(
                    arc,
                    with: .color(resolvedColor.opacity(1.0 - Double(idx) * 0.22)),
                    style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round)
                )
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
