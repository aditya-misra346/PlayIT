# Auralis for iOS & iPadOS

Native SwiftUI iOS and iPadOS client for **Auralis** (*"Hear it. Know it."*), an original music-recognition product implementing `docs/CONTRACT.md`.

---

## Architecture & Directory Layout

```text
ios/
├── project.yml                      # XcodeGen project specification (iOS 16.0+, iPhone & iPad)
├── README.md                        # Build, signing, ShazamKit, TestFlight & verification guide
├── AuralisCore/                     # Shared Swift Package (iOS 16+, macOS 13+)
│   ├── Package.swift
│   ├── Sources/AuralisCore/
│   │   ├── BrandTheme.swift         # Auralis dark-only palette, hex constants, signature gradient
│   │   ├── Models.swift             # 11 RecognitionStates, TrackMatch, LibraryItem, API DTOs
│   │   ├── AudioDSP.swift           # Quality gate, DC removal, windowed-sinc 16 kHz resampler, WAV 16-bit encoder
│   │   ├── ShazamKitMapper.swift    # SHMatchedMediaItem -> TrackMatch mapper & ShazamKit session coordinator
│   │   ├── LibraryStore.swift       # Metadata-only persistent JSON store with V0/V1 -> V2 schema migration
│   │   ├── AuralisAPIClient.swift   # HTTP client (/api/v1/recognize, /config, /auth/*, /library/sync)
│   │   ├── AudioCaptureManager.swift# AVAudioSession (.measurement) + AVAudioEngine real-time input tap
│   │   └── RecognitionStateMachine.swift # Full 11-state recognition lifecycle & provider fallback
│   └── Tests/AuralisCoreTests/
│       └── AuralisCoreTests.swift   # Unit test suite verified on macOS via `swift test`
└── App/                             # SwiftUI iOS/iPadOS Application Target
    ├── AuralisApp.swift             # @main App entry point, dark-only theme, background auto-stop
    ├── Info.plist                   # NSMicrophoneUsageDescription, orientations, dark UI style
    ├── PrivacyInfo.xcprivacy        # Apple App Store Privacy Manifest
    ├── Auralis.entitlements         # com.apple.developer.shazamkit entitlement
    └── Views/
        ├── RootAdaptiveView.swift   # Adaptive TabView (compact iPhone) / NavigationSplitView (regular iPad)
        ├── ListenView.swift         # Concentric audio-reactive rings, live dBFS meter, instant cancel, mic picker
        ├── ResultDetailView.swift   # Blurred artwork hero, metadata, provider/confidence badges, links, ShareLink
        ├── LibraryView.swift        # Search, artist/date/favorites filters, swipe-to-delete, JSON export
        └── SettingsView.swift       # Provider mode picker, mic input selector, server URL, optional account sync
```

---

## Running Unit Tests & Typechecking (Without Full Xcode.app)

All DSP, quality gate, WAV encoding, `SHMatchedMediaItem` → `TrackMatch` mapping, library persistence + schema migration, API client, and state machine logic live in `AuralisCore` and run natively via the Swift Command Line Tools:

```bash
cd ios/AuralisCore
swift test
```

To typecheck all SwiftUI views in `ios/App` against `AuralisCore` using `swiftc`:

```bash
cd ios
mkdir -p /tmp/auralis-typecheck
swiftc -emit-module -module-name AuralisCore \
  -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk \
  -target arm64-apple-macos13.0 \
  -emit-module-path /tmp/auralis-typecheck/AuralisCore.swiftmodule \
  AuralisCore/Sources/AuralisCore/*.swift
swiftc -typecheck \
  -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk \
  -target arm64-apple-macos13.0 \
  -I /tmp/auralis-typecheck \
  App/AuralisApp.swift \
  App/Views/RootAdaptiveView.swift \
  App/Views/ListenView.swift \
  App/Views/ResultDetailView.swift \
  App/Views/LibraryView.swift \
  App/Views/SettingsView.swift
rm -rf /tmp/auralis-typecheck
```

---

## Generating the Xcode Project with XcodeGen

When building on a Mac with full `Xcode.app` (Xcode 15+ / 16+) installed:

1. Install [XcodeGen](https://github.com/yonaskolb/XcodeGen) if not already installed:
   ```bash
   brew install xcodegen
   ```
2. Generate `Auralis.xcodeproj` from `ios/project.yml`:
   ```bash
   cd ios
   xcodegen generate
   open Auralis.xcodeproj
   ```

---

## Enabling Apple ShazamKit & Code Signing

1. **Apple Developer Portal (App ID Setup)**:
   - Sign in to [Apple Developer Account → Certificates, Identifiers & Profiles → Identifiers](https://developer.apple.com/account/resources/identifiers/list).
   - Register or select the App ID matching your bundle identifier (`com.auralis.ios`).
   - Under **App Services**, enable **ShazamKit** and save.
2. **Xcode Signing & Capabilities**:
   - Open `Auralis.xcodeproj`, select the `Auralis` target → **Signing & Capabilities**.
   - Select your Apple Developer Team.
   - Verify the **ShazamKit** capability (`com.apple.developer.shazamkit` in `App/Auralis.entitlements`) is present.
3. **Provider Modes in Settings**:
   - **ShazamKit (On-Device Signature)**: Computes an `SHSignature` on-device (`SHSignatureGenerator` + `SHSession` / `SHManagedSession` on iOS 17+) and matches against the Apple Shazam catalog.
   - **Auralis Cloud Server**: Runs the pre-upload quality gate (`rmsDbfs`, `peak`, `clippingRatio`, `silenceRatio`), removes DC offset, downsamples via a Blackman windowed-sinc filter to 16 kHz mono, normalizes quiet peaks (`peak < 0.5`) to `-1 dBFS`, encodes 16-bit PCM WAV, and uploads to `POST /api/v1/recognize`.
   - **Auto (ShazamKit with Cloud Fallback on Service Error)**: Attempts on-device ShazamKit first and automatically falls back to the Auralis Cloud Server if ShazamKit is unavailable or returns a service error.

---

## Audio Capture & iOS/iPadOS Sandboxing Rules

- **Measurement Mode**: Configures `AVAudioSession` with `.playAndRecord` and `.measurement` mode (`[.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker]`) and disables `AVAudioInputNode` voice processing so music is captured without AGC, echo cancellation, or noise suppression.
- **No Internal System Audio Capture**: Due to iOS/iPadOS security sandboxing, apps cannot capture internal system audio from other apps. Both the Listen screen and Settings screen clearly explain this and provide an input microphone selector (`AVAudioSession.sharedInstance().availableInputs` / `setPreferredInput`).
- **Interruptions, Route Changes & Backgrounding**:
  - Handles `AVAudioSession.interruptionNotification` and `AVAudioSession.routeChangeNotification` (transitions to `mic_unavailable` if the active microphone disconnects mid-capture).
  - Automatically cancels capture immediately when `scenePhase == .background` (no background recording).

---

## TestFlight & App Store Submission Checklist

- [x] `App/Info.plist` includes `NSMicrophoneUsageDescription` explaining explicit user-initiated ~10-second music capture.
- [x] `App/PrivacyInfo.xcprivacy` declares `NSPrivacyCollectedDataTypeAudioData` (App Functionality, not linked, not used for tracking), optional `NSPrivacyCollectedDataTypeEmailAddress` for account sync, and `NSPrivacyAccessedAPICategoryUserDefaults` (`CA92.1`).
- [x] `App/Auralis.entitlements` declares `com.apple.developer.shazamkit`.
- [ ] In Xcode (`Product → Archive`), archive with a distribution provisioning profile that includes the ShazamKit App Service entitlement and upload via Xcode Organizer or `xcrun altool` / Transporter to App Store Connect.

---

## Verification Status on This Machine

- **Verified**:
  - `swift test` in `ios/AuralisCore` passes all 12 unit test suites covering brand/states contract, DC offset removal, stereo-to-mono & `AVAudioPCMBuffer` extraction, live RMS level mapping (`-60..0 dBFS → 0..1`), quality gate (`too_quiet` blocking upload, `clippingRatio > 0.05` warning banner), gentle peak normalization (`peak < 0.5 → -1 dBFS`), 48 kHz → 16 kHz windowed-sinc resampling, 16-bit mono WAV encoding, `SHMediaItem` → `TrackMatch` mapping (with `confidence: nil`), `SHSignatureGenerator` acoustic signature creation, `LibraryStore` Schema V1 → V2 migration + filtering + remote tombstone merge + JSON export, and `RecognitionStateMachine` auto-fallback & error mapping.
  - `swiftc -typecheck` of all SwiftUI files (`AuralisApp.swift`, `RootAdaptiveView.swift`, `ListenView.swift`, `ResultDetailView.swift`, `LibraryView.swift`, `SettingsView.swift`) against `AuralisCore` succeeds with zero errors.
- **Unverified on this machine (requires full Xcode.app + physical iOS device / Apple Developer provisioning)**:
  - `xcodegen generate` + `xcodebuild` for `iphoneos` / `iphonesimulator` SDKs (this host only has CommandLineTools installed, not `Xcode.app`).
  - Live `SHSession` catalog network matching against Apple's production ShazamKit service (requires a signed bundle with a provisioned `com.apple.developer.shazamkit` entitlement).
