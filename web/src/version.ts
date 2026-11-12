export const APP_VERSION = '1.3.0';
export const APP_BUILD_NUMBER = 5;
export const APP_RELEASE_DATE = '2026-11-12';
export const SUPPORTED_PLATFORMS = [
  { id: 'web', name: 'Web & Installable PWA', version: '1.3.0', status: 'synchronized' },
  { id: 'android', name: 'Android (Phone & Tablet)', version: '1.3.0 (vc 5)', status: 'synchronized' },
  { id: 'ios', name: 'iOS & iPadOS (ShazamKit)', version: '1.3.0 (build 5)', status: 'synchronized' },
  { id: 'macos', name: 'macOS Desktop (Apple Silicon & Intel)', version: '1.3.0', status: 'synchronized' },
  { id: 'windows', name: 'Windows Desktop (WASAPI Loopback)', version: '1.3.0', status: 'synchronized' },
  { id: 'linux', name: 'Linux Desktop (PipeWire / PulseAudio)', version: '1.3.0', status: 'synchronized' },
] as const;
