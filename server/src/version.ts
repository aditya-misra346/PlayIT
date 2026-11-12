export const RELEASE_MANIFEST = {
  version: '1.1.0',
  buildNumber: 2,
  releaseDate: '2026-11-12',
  channel: 'production',
  minCompatibleVersion: '1.0.0',
  notes: "Unified cross-platform release v1.1.0 across Web, PWA, Android, iOS/iPadOS, macOS, Windows, and Linux with Constellation-Peak acoustic fingerprinting, AudD/ACRCloud/ShazamKit adapters, and real-time version sync.",
  platforms: {
    web: { version: '1.1.0', buildNumber: 2, target: 'Vercel Production + Installable PWA' },
    android: { version: '1.1.0', versionCode: 2, minSdk: 26, targetSdk: 35 },
    ios: { version: '1.1.0', buildNumber: 2, minOs: '16.0' },
    macos: { version: '1.1.0', buildNumber: 2, engine: 'Tauri 2 + ScreenCaptureKit + cpal' },
    windows: { version: '1.1.0', buildNumber: 2, engine: 'Tauri 2 + WASAPI Loopback + cpal' },
    linux: { version: '1.1.0', buildNumber: 2, engine: 'Tauri 2 + PipeWire/PulseAudio + cpal' },
  },
} as const;
