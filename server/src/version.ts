export const RELEASE_MANIFEST = {
  version: '1.4.0',
  buildNumber: 6,
  releaseDate: '2026-11-12',
  channel: 'production',
  minCompatibleVersion: '1.0.0',
  notes: "Unified cross-platform release v1.4.0 across Web, PWA, Android, iOS/iPadOS, macOS, Windows, and Linux with 83-track Constellation-Peak catalog, per-band adaptive noise floor thresholding, 50x faster polyphase Blackman-sinc resampler, and 10,000-song benchmark infrastructure.",
  platforms: {
    web: { version: '1.4.0', buildNumber: 6, target: 'Vercel Production + Installable PWA' },
    android: { version: '1.4.0', versionCode: 6, minSdk: 26, targetSdk: 35 },
    ios: { version: '1.4.0', buildNumber: 6, minOs: '16.0' },
    macos: { version: '1.4.0', buildNumber: 6, engine: 'Tauri 2 + ScreenCaptureKit + cpal' },
    windows: { version: '1.4.0', buildNumber: 6, engine: 'Tauri 2 + WASAPI Loopback + cpal' },
    linux: { version: '1.4.0', buildNumber: 6, engine: 'Tauri 2 + PipeWire/PulseAudio + cpal' },
  },
} as const;
