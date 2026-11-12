# PlayIT — Hear it. Know it.

**PlayIT** is a cross-platform acoustic music recognition platform spanning **Web (Desktop & Mobile Browsers + Installable PWA)**, **Android (Kotlin + Jetpack Compose)**, **iOS & iPadOS (SwiftUI + ShazamKit)**, and **Desktop (macOS, Windows, Linux via Tauri 2 + Rust + native system-audio capture)**.

- **Official Website:** [https://playit.vercel.app/](https://playit.vercel.app/) *(Live Production Deployment: https://auralis-eight-kohl.vercel.app)*
- **GitHub Repository:** [https://github.com/aditya-misra346/PlayIT](https://github.com/aditya-misra346/PlayIT)

---

## 1. Repository Layout

| Directory | Description |
| :--- | :--- |
| [`docs/CONTRACT.md`](./docs/CONTRACT.md) | Shared cross-platform specification: brand system, recognition state machine, audio quality gate, normalized `TrackMatch` schema, HTTP API contract, and Tauri IPC commands |
| [`server/`](./server/) | Node.js + TypeScript recognition backend: multi-provider orchestrator (`AudD`, `ACRCloud`, `LocalCatalogProvider`), ShazamKit ES256 developer-token signer, Deezer public metadata enricher, rate limiter, cost tracker, and cloud library sync |
| [`web/`](./web/) | React 19 + TypeScript + Vite 6 responsive Web App & installable PWA with Web Audio real-time radial spectrum & RMS visualizer, microphone selector, file recognition, Acoustic Test Studio, and Tauri 2 native desktop bridge |
| [`desktop/`](./desktop/) | Tauri 2 + Rust native desktop app with `cpal` cross-platform microphone capture, macOS `ScreenCaptureKit` system-audio sidecar, Windows WASAPI loopback, and Linux PipeWire/PulseAudio monitor capture |
| [`android/`](./android/) | Native Android app (Kotlin, Jetpack Compose, Material 3) with `AudioRecord` (`UNPROCESSED`/`MIC`), Android 10+ `AudioPlaybackCapture` (`MediaProjection` foreground service), pure-Kotlin DSP & quality gate, and Server + optional ShazamKit AAR providers |
| [`ios/`](./ios/) | Native iOS/iPadOS app (SwiftUI + `AuralisCore` Swift Package) with on-device `ShazamKit` (`SHManagedSession` / `SHSession`) + cloud fallback, `AVAudioSession` `.measurement` mode, and adaptive iPhone/iPad split navigation |
| [`.github/workflows/desktop-release.yml`](./.github/workflows/desktop-release.yml) | Cross-platform release pipeline building macOS (`.dmg` / `.app`), Windows (`.exe` NSIS / `.msi`), and Linux (`.AppImage` / `.deb` / `.rpm`) bundles |

---

## 2. Recognition Provider Evaluation & Multi-Provider Architecture

PlayIT implements a modular `RecognitionProvider` interface (`server/src/types.ts`) normalized into a single `TrackMatch` schema:

| Provider | Catalog & Strengths | Confidence Score | Pricing & Quotas | Role in PlayIT |
| :--- | :--- | :--- | :--- | :--- |
| **Apple ShazamKit** | Official global Shazam catalog; on-device acoustic signature generation (`SHSignatureGenerator`) so raw audio never leaves the device on iOS/Android | Not exposed by SDK (`confidence: null` — never fabricated) | Included with Apple Developer membership ($99/yr); Android/Web use server-signed ES256 JWT (`GET /api/v1/shazamkit/token`) | Primary native engine on iOS/iPadOS; optional AAR provider on Android |
| **ACRCloud (`/v1/identify`)** | 100M+ tracks; returns genuine match `score` (70–100), `play_offset_ms`, ISRC, and Spotify/Deezer/YouTube track IDs | Yes (`score` 0–100 surfaced as `confidence`) | 14-day free trial; metered ~$6 per 1,000 requests | Primary server-side cloud provider when `ACRCLOUD_HOST`, `ACRCLOUD_ACCESS_KEY`, `ACRCLOUD_ACCESS_SECRET` are set |
| **AudD (`api.audd.io`)** | Broad commercial catalog; returns rich Apple Music, Spotify, Deezer, and MusicBrainz metadata + `timecode` in one call | Not supplied (`confidence: null` — never fabricated) | 300 free trial requests; Indie plan $5/mo for 1,000 requests ($0.005/req) | Primary or secondary fallback server-side cloud provider when `AUDD_API_TOKEN` is set |
| **PlayIT Acoustic Engine (`local`)** | Built-in Wang (2003) constellation-peak + time-coherent offset histogram engine (`server/src/fingerprint/engine.ts`) preloaded with 8 multi-genre reference tracks + custom WAV ingestion (`POST /api/v1/catalog/ingest`) | Yes (70–100 derived from aligned time-offset hash density) | Free ($0/req, zero external dependencies) | Active out-of-the-box for immediate verification, offline/local catalogs, and automated multi-condition accuracy testing |

---

## 3. Audio Capture & Platform Support Matrix

| Platform | Universal Microphone Capture | Internal / System Audio Capture | Honest Platform Limitations |
| :--- | :--- | :--- | :--- |
| **Web & PWA** | `navigator.mediaDevices.getUserMedia` (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`), live device picker | Desktop Chromium `getDisplayMedia({ audio: true })` tab/system share | Mobile browsers (iOS Safari, Android Chrome) do not expose internal system audio capture; UI explains this and offers Microphone or File upload |
| **iOS & iPadOS** | `AVAudioEngine` + `AVAudioSession` (`.measurement` mode), Built-in, Wired, USB, and Bluetooth HFP input picker | Not permitted by iOS sandboxing | App clearly informs the user that iOS does not allow capturing audio from other apps and uses the microphone |
| **Android** | `AudioRecord` (`UNPROCESSED` when supported, fallback `MIC`), input device selection + `AudioDeviceCallback` disconnect detection | Android 10+ (API 29+) `AudioPlaybackCapture` via user-approved `MediaProjection` foreground service | Source apps that set `allowAudioPlaybackCapture="false"` or DRM streams cannot be captured; PlayIT detects silence and suggests Microphone mode |
| **macOS Desktop** | `cpal` CoreAudio input stream with device selection | Native Swift `ScreenCaptureKit` helper (`SCStream` with `capturesAudio = true`, `excludesCurrentProcessAudio = true`) | Requires user-approved **Screen & System Audio Recording** permission in macOS System Settings; falls back to Microphone if denied |
| **Windows Desktop** | `cpal` WASAPI input stream with device selection | Native WASAPI Loopback on default or selected render endpoint | DRM-protected streams may produce silence; PlayIT detects silent loopback and prompts for Microphone fallback |
| **Linux Desktop** | `cpal` ALSA/PipeWire/PulseAudio input stream | PulseAudio / PipeWire-Pulse `@DEFAULT_MONITOR@` & `.monitor` source capture (`parec` / `cpal`) | Works across Ubuntu, Debian, Fedora (GNOME/KDE, X11/Wayland) when `pipewire-pulse` or PulseAudio is active; falls back to Microphone otherwise |

---

## 4. Quick Start (Web + Backend Server)

```bash
# 1. Run the 17-test server & multi-condition acoustic accuracy suite
cd server
npm test

# 2. Build both backend server and web/PWA bundle
cd ..
npm run build

# 3. Start the unified production server (serves API + Web/PWA at http://localhost:8787)
npm start
```
