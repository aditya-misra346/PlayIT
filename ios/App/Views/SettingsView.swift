import SwiftUI
import AuralisCore

public struct SettingsView: View {
    @ObservedObject public var stateMachine: RecognitionStateMachine
    @ObservedObject private var captureManager: AudioCaptureManager

    @State private var authEmail: String = ""
    @State private var authPassword: String = ""
    @State private var isRegisterMode: Bool = false
    @State private var showDeleteAccountConfirmation: Bool = false
    @State private var serverCheckMessage: String? = nil
    @State private var isCheckingServer: Bool = false

    public init(stateMachine: RecognitionStateMachine) {
        self.stateMachine = stateMachine
        self._captureManager = ObservedObject(wrappedValue: stateMachine.audioCaptureManager)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                recognitionProviderSection

                audioInputAndSandboxSection

                cloudServerConfigurationSection

                accountAndSyncSection

                privacyAndDiagnosticsSection
            }
            .padding(20)
        }
        .background(AuralisBrand.midnightBg.ignoresSafeArea())
        .navigationTitle("Settings")
        .confirmationDialog(
            "Permanently delete your Auralis cloud account and all synced data?",
            isPresented: $showDeleteAccountConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Account & Data", role: .destructive) {
                Task {
                    try? await stateMachine.deleteCloudAccount()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This calls DELETE /api/v1/account and removes your cloud account and synced library permanently.")
        }
    }

    // MARK: - 1. Recognition Provider Section

    private var recognitionProviderSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Recognition Provider", icon: "waveform.badge.magnifyingglass")

            ForEach(RecognitionProviderMode.allCases) { mode in
                let isSelected = stateMachine.providerMode == mode
                Button {
                    stateMachine.providerMode = mode
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                            .font(.title3)
                            .foregroundStyle(isSelected ? AuralisBrand.cyan : AuralisBrand.mutedText)
                            .padding(.top, 2)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(mode.displayName)
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(AuralisBrand.primaryText)

                            Text(mode.summaryDescription)
                                .font(.caption)
                                .foregroundStyle(AuralisBrand.mutedText)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Spacer()
                    }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(isSelected ? AuralisBrand.charcoalElevated : AuralisBrand.deepSurface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(
                                        isSelected ? AuralisBrand.cyan.opacity(0.75) : AuralisBrand.lineBorder,
                                        lineWidth: 1
                                    )
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - 2. Audio Input & iOS Sandboxing Notice

    private var audioInputAndSandboxSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                sectionTitle("Audio Input & iOS Sandboxing", icon: "mic.fill")
                Spacer()
                Button {
                    captureManager.refreshAvailableInputs()
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AuralisBrand.cyan)
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 10) {
                ForEach(captureManager.availableInputs) { input in
                    let isSelected = (captureManager.selectedInputId == input.id)
                        || (captureManager.selectedInputId == nil && input.isDefault)
                    Button {
                        try? captureManager.selectPreferredInput(deviceId: input.id)
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(input.name)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(AuralisBrand.primaryText)
                                Text("Port: \(input.portType)")
                                    .font(.caption2)
                                    .foregroundStyle(AuralisBrand.mutedText)
                            }
                            Spacer()
                            if isSelected {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(AuralisBrand.teal)
                            }
                        }
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(AuralisBrand.charcoalElevated)
                        )
                    }
                    .buttonStyle(.plain)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Label("Why Internal App Audio Cannot Be Captured on iOS", systemImage: "lock.shield.fill")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AuralisBrand.cyan)

                    Text("Due to iOS and iPadOS security sandboxing, apps cannot record internal system audio playing inside other apps. Auralis captures acoustic audio from your selected microphone using AVAudioSession `.measurement` mode (disabling voice processing, echo cancellation, noise suppression, and auto-gain) and never records in the background.")
                        .font(.caption)
                        .foregroundStyle(AuralisBrand.mutedText)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(AuralisBrand.midnightBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                        )
                )
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
    }

    // MARK: - 3. Cloud Server Endpoint Section

    private var cloudServerConfigurationSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Auralis Cloud Server", icon: "server.rack")

            VStack(alignment: .leading, spacing: 12) {
                Text("Server Base URL")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AuralisBrand.mutedText)

                TextField("http://localhost:8787", text: $stateMachine.serverBaseURLString)
                    .textFieldStyle(.plain)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(AuralisBrand.primaryText)
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(AuralisBrand.charcoalElevated)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(AuralisBrand.lineBorder, lineWidth: 1)
                            )
                    )
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .autocorrectionDisabled()

                HStack(spacing: 12) {
                    Button {
                        checkServerConfiguration()
                    } label: {
                        HStack(spacing: 6) {
                            if isCheckingServer {
                                ProgressView()
                                    .scaleEffect(0.8)
                            } else {
                                Image(systemName: "network")
                            }
                            Text("Test Connection (/api/v1/config)")
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(AuralisBrand.midnightBg)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Capsule().fill(AuralisBrand.cyan))
                    }
                    .buttonStyle(.plain)
                    .disabled(isCheckingServer)

                    Spacer()
                }

                if let msg = serverCheckMessage {
                    Text(msg)
                        .font(.caption)
                        .foregroundStyle(AuralisBrand.mutedText)
                }
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
    }

    private func checkServerConfiguration() {
        isCheckingServer = true
        serverCheckMessage = nil
        Task { @MainActor in
            defer { isCheckingServer = false }
            do {
                let config = try await stateMachine.apiClient.fetchConfig()
                let names = config.providers.map(\.name).joined(separator: ", ")
                serverCheckMessage = "Connected. Server providers: \(names.isEmpty ? "None" : names)."
            } catch {
                serverCheckMessage = error.localizedDescription
            }
        }
    }

    // MARK: - 4. Optional Account Sign-In & Cloud Library Sync

    private var accountAndSyncSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Account & Cloud Library Sync (Optional)", icon: "person.crop.circle.badge.checkmark")

            VStack(alignment: .leading, spacing: 14) {
                if let user = stateMachine.signedInUser {
                    HStack {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Signed In")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(AuralisBrand.teal)
                            Text(user.email)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(AuralisBrand.primaryText)
                            if let lastSync = stateMachine.libraryStore.lastServerSyncAt {
                                Text("Last synced: \(lastSync)")
                                    .font(.caption2)
                                    .foregroundStyle(AuralisBrand.mutedText)
                            }
                        }
                        Spacer()
                    }

                    HStack(spacing: 10) {
                        Button {
                            Task {
                                try? await stateMachine.syncLibraryWithCloud()
                            }
                        } label: {
                            Label(
                                stateMachine.isSyncingAccount ? "Syncing…" : "Sync Library Now",
                                systemImage: "arrow.triangle.2.circlepath"
                            )
                            .font(.caption.weight(.bold))
                            .foregroundStyle(AuralisBrand.midnightBg)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(Capsule().fill(AuralisBrand.cyan))
                        }
                        .buttonStyle(.plain)
                        .disabled(stateMachine.isSyncingAccount)

                        Button {
                            stateMachine.logoutAccount()
                        } label: {
                            Text("Sign Out")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AuralisBrand.primaryText)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(
                                    Capsule()
                                        .fill(AuralisBrand.charcoalElevated)
                                )
                        }
                        .buttonStyle(.plain)

                        Spacer()

                        Button(role: .destructive) {
                            showDeleteAccountConfirmation = true
                        } label: {
                            Text("Delete Account")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(AuralisBrand.danger)
                        }
                        .buttonStyle(.plain)
                    }
                } else {
                    Text("Local history works without an account. Sign in to sync your recognition library across devices.")
                        .font(.caption)
                        .foregroundStyle(AuralisBrand.mutedText)

                    Picker("Mode", selection: $isRegisterMode) {
                        Text("Sign In").tag(false)
                        Text("Create Account").tag(true)
                    }
                    .pickerStyle(.segmented)

                    TextField("Email address", text: $authEmail)
                        .textFieldStyle(.plain)
                        .font(.subheadline)
                        .foregroundStyle(AuralisBrand.primaryText)
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(AuralisBrand.charcoalElevated)
                        )
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()

                    SecureField("Password", text: $authPassword)
                        .textFieldStyle(.plain)
                        .font(.subheadline)
                        .foregroundStyle(AuralisBrand.primaryText)
                        .padding(10)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(AuralisBrand.charcoalElevated)
                        )

                    Button {
                        Task {
                            if isRegisterMode {
                                try? await stateMachine.registerAccount(email: authEmail, password: authPassword)
                            } else {
                                try? await stateMachine.loginAccount(email: authEmail, password: authPassword)
                            }
                            if stateMachine.signedInUser != nil {
                                authPassword = ""
                            }
                        }
                    } label: {
                        Text(isRegisterMode ? "Create Account & Sync" : "Sign In & Sync")
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(AuralisBrand.midnightBg)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 11)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(AuralisBrand.signatureGradient)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(authEmail.isEmpty || authPassword.isEmpty || stateMachine.isSyncingAccount)
                }

                if let authError = stateMachine.accountErrorMessage {
                    Text(authError)
                        .font(.caption)
                        .foregroundStyle(AuralisBrand.danger)
                }
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
    }

    // MARK: - 5. Privacy & Diagnostics

    private var privacyAndDiagnosticsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Privacy & Storage", icon: "hand.raised.fill")

            VStack(alignment: .leading, spacing: 8) {
                Text("• Audio is captured only on explicit user action (~10s target) with a visible recording indicator and instant cancel.")
                    .font(.caption)
                    .foregroundStyle(AuralisBrand.mutedText)
                Text("• Local Library stores song metadata only (Schema v\(LibraryStore.currentSchemaVersion)). Raw audio is never persisted on disk.")
                    .font(.caption)
                    .foregroundStyle(AuralisBrand.mutedText)
                Text("• Anonymous Install ID (rate-limiting only): \(stateMachine.apiClient.installId)")
                    .font(.caption2.monospaced())
                    .foregroundStyle(AuralisBrand.mutedText)
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
    }

    private func sectionTitle(_ title: String, icon: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .foregroundStyle(AuralisBrand.cyan)
            Text(title)
                .font(.headline.weight(.bold))
                .foregroundStyle(AuralisBrand.primaryText)
        }
    }
}
