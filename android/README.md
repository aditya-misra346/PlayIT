# Auralis for Android (`app.auralis`)

Native Android client for **Auralis** (*"Hear it. Know it."*), an original music-recognition product built with **Kotlin**, **Jetpack Compose (Material 3)**, **Room**, **DataStore**, **OkHttp**, **Coil**, and a pure-Kotlin **DSP** pipeline.

---

## Architecture & Package Layout

| Package | Responsibility |
| --- | --- |
| `app.auralis.dsp` | Pure-Kotlin DSP pipeline (`AudioDsp`, `WavEncoder`): stereo→mono conversion, DC-offset removal, pre-upload quality gate (`rmsDbfs`, `peak`, `clippingRatio`, `silenceRatio`), Blackman windowed-sinc anti-aliased resampler to 16 kHz, gentle peak normalization to −1 dBFS (when `peak < 0.5`), live 50 ms level meter (`−60..0 dBFS` → `0..1`), and 16-bit PCM mono RIFF/WAVE encoder. |
| `app.auralis.audio` | `MicrophoneCapture` (`AudioRecord` with `UNPROCESSED` source fallback to `MIC`, voice effects disabled, input device selection via `AudioManager.getDevices(GET_DEVICES_INPUTS)` + `setPreferredDevice`, Bluetooth SCO routing, `AudioDeviceCallback` disconnect detection) and `PlaybackCapture` + `PlaybackCaptureService` (Android 10+/API 29 `MediaProjection` + `AudioPlaybackCaptureConfiguration` with `foregroundServiceType="mediaProjection"` for API 34+). |
| `app.auralis.recognition` | `RecognitionProvider` interface, `AuralisApiClient` (`/api/v1/*` contract client with `X-Auralis-Client` and `X-Auralis-Install` headers), `ServerRecognitionProvider` (`POST /api/v1/recognize` multipart), and `shazamkit.ShazamKitProvider` (optional on-device ShazamKit provider using server-minted ES256 tokens from `GET /api/v1/shazamkit/token`). |
| `app.auralis.data` | Versioned Room database (`AuralisDatabase`, schema v1 exported to `app/schemas/` with explicit `MIGRATION_1_2` hook) storing `LibraryItem` track metadata only (raw audio is never persisted) and `AuralisPreferences` DataStore. |
| `app.auralis.ui` | Dark-only Auralis Material 3 theme (`Midnight #060A14`, `Deep #0B1220`, `Charcoal #121A2B`, signature gradient `#2F6BFF → #22D3EE → #14B8A6`), custom `AuralisMark`, adaptive layout (`NavigationBar` on phones, `NavigationRail` + two-pane master/detail on tablets/foldables), `ListenScreen`, `ResultScreen`, `LibraryScreen`, and `SettingsScreen`. |

---

## Building & Running Tests

### Prerequisites
- **JDK 17** (`JAVA_HOME`)
- **Android SDK** (`ANDROID_HOME`) with `platforms;android-35` and `build-tools;35.0.0`

### Run JVM Unit Tests & Assemble Debug APK
```bash
export JAVA_HOME="$HOME/.local/toolchains/jdk17"
export ANDROID_HOME="$HOME/.local/toolchains/android-sdk"

./gradlew testDebugUnitTest assembleDebug
```

The debug APK is generated at:
- `app/build/outputs/apk/debug/app-debug.apk` (or `app/build/outputs/apk/standard/debug/app-standard-debug.apk` when the optional ShazamKit AAR is present).

### Override Recognition Server Base URL
- **Debug default**: `http://10.0.2.2:8787` (reaches host machine's `localhost:8787` from the Android Emulator).
- **Build-time override**:
  ```bash
  ./gradlew assembleDebug -PauralisApiBase=http://192.168.1.20:8787
  ```
- **Runtime override**: Configurable anytime in **Settings → Recognition Server & Providers → API Base URL**.

---

## Optional On-Device ShazamKit Integration

The app compiles and runs out-of-the-box without Apple's proprietary ShazamKit AAR. To enable on-device ShazamKit catalog matching:
1. Download `shazamkit-android-release.aar` from the Apple Developer portal.
2. Place it at `android/app/libs/shazamkit-android-release.aar`.
3. `app/build.gradle.kts` automatically detects the file, enables the `shazamkit` product flavor, and `ShazamKitProvider` fetches short-lived ES256 developer tokens from `GET /api/v1/shazamkit/token` (developer keys are never embedded in the client).

---

## Release Signing & R8

1. Copy `keystore.properties.example` to `keystore.properties` (git-ignored) and populate `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`.
2. Build a minified, resource-shrunk release APK/AAB:
   ```bash
   ./gradlew assembleRelease
   ```
