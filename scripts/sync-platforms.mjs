#!/usr/bin/env node
/**
 * Auralis Cross-Platform Synchronization Engine (`scripts/sync-platforms.mjs`)
 *
 * Ensures every update made to the website / `version.json` is automatically propagated across:
 *   1. Web & PWA (`web/package.json`, `web/src/version.ts`, `web/public/sw.js`)
 *   2. Recognition Backend (`server/package.json`, `server/src/version.ts`)
 *   3. Desktop — macOS, Windows, Linux (`desktop/src-tauri/tauri.conf.json`, `Cargo.toml`, `Info.plist`)
 *   4. Android (`android/app/build.gradle.kts` — `versionCode` & `versionName`)
 *   5. iOS & iPadOS (`ios/project.yml` — `MARKETING_VERSION` & `CURRENT_PROJECT_VERSION`)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const bumpIdx = args.indexOf('--bump');

const versionFile = join(ROOT, 'version.json');
const manifest = JSON.parse(readFileSync(versionFile, 'utf8'));

if (bumpIdx !== -1) {
  const kind = args[bumpIdx + 1] || 'patch';
  const [maj, min, pat] = String(manifest.version).split('.').map(Number);
  if (kind === 'major') manifest.version = `${maj + 1}.0.0`;
  else if (kind === 'minor') manifest.version = `${maj}.${min + 1}.0`;
  else manifest.version = `${maj}.${min}.${pat + 1}`;
  manifest.buildNumber = Number(manifest.buildNumber || 1) + 1;
  manifest.releaseDate = new Date().toISOString().slice(0, 10);
  for (const key of Object.keys(manifest.platforms || {})) {
    manifest.platforms[key].version = manifest.version;
    if ('buildNumber' in manifest.platforms[key]) manifest.platforms[key].buildNumber = manifest.buildNumber;
    if ('versionCode' in manifest.platforms[key]) manifest.platforms[key].versionCode = manifest.buildNumber;
  }
  writeFileSync(versionFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

const { version, buildNumber, releaseDate, channel, minCompatibleVersion, notes } = manifest;
const driftFiles = [];

function updateFile(relPath, transformFn) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return;
  const current = readFileSync(abs, 'utf8');
  const next = transformFn(current);
  if (current !== next) {
    if (checkOnly) {
      driftFiles.push(relPath);
    } else {
      writeFileSync(abs, next, 'utf8');
      console.log(`[sync-platforms] Updated ${relPath} -> v${version} (build ${buildNumber})`);
    }
  }
}

// 1. Root, Server, and Web package.json
for (const pkgPath of ['package.json', 'server/package.json', 'web/package.json']) {
  updateFile(pkgPath, (raw) => {
    const obj = JSON.parse(raw);
    obj.version = version;
    return `${JSON.stringify(obj, null, 2)}\n`;
  });
}

// 2. Server version.ts
updateFile('server/src/version.ts', () => {
  return `export const RELEASE_MANIFEST = {
  version: '${version}',
  buildNumber: ${buildNumber},
  releaseDate: '${releaseDate}',
  channel: '${channel}',
  minCompatibleVersion: '${minCompatibleVersion}',
  notes: ${JSON.stringify(notes)},
  platforms: {
    web: { version: '${version}', buildNumber: ${buildNumber}, target: 'Vercel Production + Installable PWA' },
    android: { version: '${version}', versionCode: ${buildNumber}, minSdk: 26, targetSdk: 35 },
    ios: { version: '${version}', buildNumber: ${buildNumber}, minOs: '16.0' },
    macos: { version: '${version}', buildNumber: ${buildNumber}, engine: 'Tauri 2 + ScreenCaptureKit + cpal' },
    windows: { version: '${version}', buildNumber: ${buildNumber}, engine: 'Tauri 2 + WASAPI Loopback + cpal' },
    linux: { version: '${version}', buildNumber: ${buildNumber}, engine: 'Tauri 2 + PipeWire/PulseAudio + cpal' },
  },
  downloads: ${JSON.stringify(manifest.downloads || {}, null, 2)},
} as const;
`;
});

// 3. Web version.ts & PWA Service Worker cache key
updateFile('web/src/version.ts', () => {
  return `export const APP_VERSION = '${version}';
export const APP_BUILD_NUMBER = ${buildNumber};
export const APP_RELEASE_DATE = '${releaseDate}';
export const SUPPORTED_PLATFORMS = [
  { id: 'web', name: 'Web & Installable PWA', version: '${version}', status: 'synchronized' },
  { id: 'android', name: 'Android (Phone & Tablet)', version: '${version} (vc ${buildNumber})', status: 'synchronized' },
  { id: 'ios', name: 'iOS & iPadOS (ShazamKit)', version: '${version} (build ${buildNumber})', status: 'synchronized' },
  { id: 'macos', name: 'macOS Desktop (Apple Silicon & Intel)', version: '${version}', status: 'synchronized' },
  { id: 'windows', name: 'Windows Desktop (WASAPI Loopback)', version: '${version}', status: 'synchronized' },
  { id: 'linux', name: 'Linux Desktop (PipeWire / PulseAudio)', version: '${version}', status: 'synchronized' },
] as const;
export const DOWNLOADS_MANIFEST = ${JSON.stringify(manifest.downloads || {}, null, 2)} as const;
`;
});

updateFile('web/public/sw.js', (raw) =>
  raw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'playit-shell-v${version}-${buildNumber}';`),
);

// 4. Desktop (macOS, Windows, Linux — Tauri 2)
updateFile('desktop/src-tauri/tauri.conf.json', (raw) => {
  const obj = JSON.parse(raw);
  obj.version = version;
  return `${JSON.stringify(obj, null, 2)}\n`;
});

updateFile('desktop/src-tauri/Cargo.toml', (raw) =>
  raw.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`),
);

updateFile('desktop/src-tauri/Cargo.lock', (raw) =>
  raw.replace(/(name = "auralis-desktop"\nversion = ")[^"]+(")/, `$1${version}$2`),
);

updateFile('desktop/src-tauri/Info.plist', (raw) =>
  raw
    .replace(
      /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
      `$1${version}$2`,
    )
    .replace(/(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/, `$1${buildNumber}$2`),
);

// 5. Android (Kotlin / Jetpack Compose)
updateFile('android/app/build.gradle.kts', (raw) =>
  raw
    .replace(/versionCode\s*=\s*\d+/, `versionCode = ${buildNumber}`)
    .replace(/versionName\s*=\s*"[^"]+"/, `versionName = "${version}"`),
);

// 6. iOS & iPadOS (XcodeGen project.yml)
updateFile('ios/project.yml', (raw) =>
  raw
    .replace(/MARKETING_VERSION:\s*"?[^"\n]+"?/, `MARKETING_VERSION: "${version}"`)
    .replace(/CURRENT_PROJECT_VERSION:\s*"?[^"\n]+"?/, `CURRENT_PROJECT_VERSION: "${buildNumber}"`),
);

if (checkOnly) {
  if (driftFiles.length > 0) {
    console.error(`[sync-platforms] Version drift detected in: ${driftFiles.join(', ')}`);
    process.exit(1);
  }
  console.log(`[sync-platforms] All platforms verified in sync at v${version} (build #${buildNumber}).`);
} else {
  console.log(`[sync-platforms] Synchronized all 6 platforms (Web/PWA, Android, iOS, macOS, Windows, Linux) to v${version} (build #${buildNumber}).`);
}
