export const RELEASE_MANIFEST = {
  version: '1.5.0',
  buildNumber: 8,
  releaseDate: '2026-11-12',
  channel: 'production',
  minCompatibleVersion: '1.0.0',
  notes: "PlayIT official rebrand across Web, PWA, Android, iOS/iPadOS, macOS, Windows, and Linux with updated branding, PlayIT logo, backward-compatible storage migration, and multi-condition acoustic music recognition engine.",
  platforms: {
    web: { version: '1.5.0', buildNumber: 8, target: 'Vercel Production + Installable PWA' },
    android: { version: '1.5.0', versionCode: 8, minSdk: 26, targetSdk: 35 },
    ios: { version: '1.5.0', buildNumber: 8, minOs: '16.0' },
    macos: { version: '1.5.0', buildNumber: 8, engine: 'Tauri 2 + ScreenCaptureKit + cpal' },
    windows: { version: '1.5.0', buildNumber: 8, engine: 'Tauri 2 + WASAPI Loopback + cpal' },
    linux: { version: '1.5.0', buildNumber: 8, engine: 'Tauri 2 + PipeWire/PulseAudio + cpal' },
  },
} as const;
