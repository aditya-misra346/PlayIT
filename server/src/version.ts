export const RELEASE_MANIFEST = {
  version: '1.3.0',
  buildNumber: 5,
  releaseDate: '2026-11-12',
  channel: 'production',
  minCompatibleVersion: '1.0.0',
  notes: "Unified cross-platform release v1.3.0 across Web, PWA, Android, iOS/iPadOS, macOS, Windows, and Linux with 58-track Constellation-Peak catalog (Shape of You, Despacito, Loser - Tame Impala, Reflections - The Neighbourhood, etc.) and canonical studio metadata enrichment.",
  platforms: {
    web: { version: '1.3.0', buildNumber: 5, target: 'Vercel Production + Installable PWA' },
    android: { version: '1.3.0', versionCode: 5, minSdk: 26, targetSdk: 35 },
    ios: { version: '1.3.0', buildNumber: 5, minOs: '16.0' },
    macos: { version: '1.3.0', buildNumber: 5, engine: 'Tauri 2 + ScreenCaptureKit + cpal' },
    windows: { version: '1.3.0', buildNumber: 5, engine: 'Tauri 2 + WASAPI Loopback + cpal' },
    linux: { version: '1.3.0', buildNumber: 5, engine: 'Tauri 2 + PipeWire/PulseAudio + cpal' },
  },
} as const;
