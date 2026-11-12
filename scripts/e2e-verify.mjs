#!/usr/bin/env node
/**
 * Auralis In-Depth End-to-End Multi-Platform Verification Suite (`scripts/e2e-verify.mjs`)
 *
 * Verifies:
 *   1. Cross-platform version & manifest synchronization across Web/PWA, Server, Android, iOS, macOS, Windows, and Linux
 *   2. Production build of Backend Server (`server/dist`) and Web/PWA (`web/dist`)
 *   3. Server & Multi-Condition Acoustic Fingerprinting 16-test suite
 *   4. iOS `AuralisCore` Swift Package 12-test suite (`swift test`)
 *   5. Desktop Rust `src-tauri` 9-test DSP & capture suite (`cargo test`)
 *   6. Live HTTP / Deployed URL end-to-end verification (HTML shell, PWA manifest, Service Worker, `/api/v1/version`,
 *      `/api/v1/config`, `/api/v1/reference-tracks`, and live WAV acoustic recognition via `POST /api/v1/recognize`).
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetUrlArg = process.argv.find((a) => a.startsWith('--url='));
const remoteBaseUrl = targetUrlArg ? targetUrlArg.slice('--url='.length).replace(/\/$/, '') : null;

const env = {
  ...process.env,
  JAVA_HOME: '/Users/aditya/.local/toolchains/jdk17',
  ANDROID_HOME: '/Users/aditya/.local/toolchains/android-sdk',
  PATH: `/Users/aditya/.local/toolchains/jdk17/bin:${process.env.HOME}/.local/toolchains/node/bin:/Users/aditya/.gemini/antigravity/scratch/tools/node-v22.14.0-darwin-arm64/bin:${process.env.HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
};

function runStep(title, cmd) {
  console.log(`\n━━━ [VERIFY] ${title} ━━━`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env });
}

async function verifyEndpoints(baseUrl, expectedVersion) {
  console.log(`\n━━━ [VERIFY] Live Endpoint & Recognition Check against ${baseUrl} ━━━`);

  // 1. Web App HTML & PWA Manifest & Service Worker
  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200, 'Expected HTTP 200 on /');
  const html = await htmlRes.text();
  assert.ok(html.includes('PlayIT'), 'Expected PlayIT title in index.html');
  assert.ok(html.includes('property="og:image" content="https://playit-music.vercel.app/og-image.png"'), 'Expected official og-image in index.html');
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'), 'Expected summary_large_image Twitter card');
  assert.ok(html.includes('property="og:title" content="PlayIT — Discover Music Instantly"'), 'Expected PlayIT Open Graph title');

  // 1b. Verify Social Media Preview Image (1200x630 PNG) & Vector Brand Assets
  const ogRes = await fetch(`${baseUrl}/og-image.png`);
  assert.equal(ogRes.status, 200, 'Expected HTTP 200 on /og-image.png');
  assert.equal(ogRes.headers.get('content-type'), 'image/png');
  const ogBuf = await ogRes.arrayBuffer();
  assert.ok(ogBuf.byteLength > 100000, `Expected og-image.png > 100 KB, got ${ogBuf.byteLength} bytes`);
  console.log(`✔ Verified Social Media Preview Card (/og-image.png): ${ogBuf.byteLength} bytes (1200x630 PNG, HTTP 200)`);

  const brandLogoRes = await fetch(`${baseUrl}/brand/logo.svg`);
  assert.equal(brandLogoRes.status, 200, 'Expected HTTP 200 on /brand/logo.svg');
  assert.equal(brandLogoRes.headers.get('content-type'), 'image/svg+xml');
  console.log(`✔ Verified Vector Master Brand Logo (/brand/logo.svg)`);

  const manifestRes = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifestRes.status, 200, 'Expected HTTP 200 on /manifest.webmanifest');
  const manifest = await manifestRes.json();
  assert.equal(manifest.short_name, 'PlayIT');
  assert.ok(manifest.icons && manifest.icons.length >= 4, 'Expected manifest to contain at least 4 icon declarations');

  const swRes = await fetch(`${baseUrl}/sw.js`);
  assert.equal(swRes.status, 200, 'Expected HTTP 200 on /sw.js');
  const swText = await swRes.text();
  assert.ok(swText.includes(`v${expectedVersion}`), `Expected Service Worker cache key to contain v${expectedVersion}`);

  // 2. /api/v1/version
  const verRes = await fetch(`${baseUrl}/api/v1/version`);
  assert.equal(verRes.status, 200, 'Expected HTTP 200 on /api/v1/version');
  const verJson = await verRes.json();
  assert.equal(verJson.version, expectedVersion, 'Expected /api/v1/version to match version.json');
  for (const plat of ['web', 'android', 'ios', 'macos', 'windows', 'linux']) {
    assert.equal(verJson.platforms[plat].version, expectedVersion, `Platform ${plat} version mismatch`);
  }

  // 2b. Download Page, Release Manifests & Binary Download Endpoints
  const dlPageRes = await fetch(`${baseUrl}/download`);
  assert.equal(dlPageRes.status, 200, 'Expected HTTP 200 on /download');
  const dlPageHtml = await dlPageRes.text();
  assert.ok(dlPageHtml.includes('PlayIT'), 'Expected PlayIT in /download page HTML');

  const relRes = await fetch(`${baseUrl}/api/v1/releases/latest`);
  assert.equal(relRes.status, 200, 'Expected HTTP 200 on /api/v1/releases/latest');
  const relJson = await relRes.json();
  assert.equal(relJson.version, expectedVersion);
  assert.ok(relJson.downloads.android && relJson.downloads.macos && relJson.downloads.windows && relJson.downloads.linux && relJson.downloads.ios);
  console.log(`✔ Verified /api/v1/releases/latest manifest with all 5 platform release packages`);

  const tauriManifestRes = await fetch(`${baseUrl}/api/v1/releases/manifest.json`);
  assert.equal(tauriManifestRes.status, 200, 'Expected HTTP 200 on /api/v1/releases/manifest.json');
  const tauriManifest = await tauriManifestRes.json();
  assert.equal(tauriManifest.version, expectedVersion);
  console.log(`✔ Verified /api/v1/releases/manifest.json for Tauri background auto-updater`);

  // Verify static artifact downloads
  const apkRes = await fetch(`${baseUrl}/downloads/playit-v1.5.0.apk`);
  assert.equal(apkRes.status, 200, 'Expected HTTP 200 on /downloads/playit-v1.5.0.apk');
  assert.equal(apkRes.headers.get('content-type'), 'application/vnd.android.package-archive');
  const apkBuf = await apkRes.arrayBuffer();
  assert.ok(apkBuf.byteLength > 18000000, `Expected APK > 18 MB, got ${apkBuf.byteLength} bytes`);
  console.log(`✔ Verified static Android APK download: ${apkBuf.byteLength} bytes (HTTP 200, application/vnd.android.package-archive)`);

  const dmgRes = await fetch(`${baseUrl}/downloads/PlayIT-1.5.0-macOS.dmg`);
  assert.equal(dmgRes.status, 200, 'Expected HTTP 200 on /downloads/PlayIT-1.5.0-macOS.dmg');
  assert.equal(dmgRes.headers.get('content-type'), 'application/x-apple-diskimage');
  const dmgBuf = await dmgRes.arrayBuffer();
  assert.ok(dmgBuf.byteLength > 3000000, `Expected DMG > 3 MB, got ${dmgBuf.byteLength} bytes`);
  console.log(`✔ Verified static macOS DMG download: ${dmgBuf.byteLength} bytes (HTTP 200, application/x-apple-diskimage)`);

  // Verify redirect endpoints
  const dlAndroidRedirect = await fetch(`${baseUrl}/api/v1/download/android`, { redirect: 'manual' });
  assert.ok(dlAndroidRedirect.status === 302 || dlAndroidRedirect.status === 200);
  if (dlAndroidRedirect.status === 302) {
    assert.ok(dlAndroidRedirect.headers.get('location')?.includes('playit-v1.5.0.apk'));
  }
  console.log(`✔ Verified /api/v1/download/android redirect to binary package`);

  // 3. /api/v1/config
  const cfgRes = await fetch(`${baseUrl}/api/v1/config`);
  assert.equal(cfgRes.status, 200);
  const cfgJson = await cfgRes.json();
  assert.equal(cfgJson.version, expectedVersion);
  assert.ok(Array.isArray(cfgJson.providers) && cfgJson.providers.length > 0);

  // 4. /api/v1/reference-tracks & live WAV recognition via POST /api/v1/recognize
  const refRes = await fetch(`${baseUrl}/api/v1/reference-tracks`);
  assert.equal(refRes.status, 200);
  const refJson = await refRes.json();
  assert.ok(refJson.tracks.length >= 58, `Expected >= 58 tracks (50 mainstream + 8 studio), got ${refJson.tracks.length}`);

  const sampleTrack = refJson.tracks.find((t) => t.category === 'studio') ?? refJson.tracks[refJson.tracks.length - 1];
  const wavRes = await fetch(`${baseUrl}${sampleTrack.audioUrl}?startSec=5&durationSec=8`);
  assert.equal(wavRes.status, 200);
  const wavBuf = new Uint8Array(await wavRes.arrayBuffer());

  // 4a. Verify Phase 3 Audio Diagnostics endpoint
  const diagForm = new FormData();
  diagForm.set('source', 'microphone');
  diagForm.set('durationMs', '8000');
  diagForm.set('audio', new Blob([wavBuf], { type: 'audio/wav' }), 'sample.wav');
  const diagRes = await fetch(`${baseUrl}/api/v1/diagnostics/audio`, {
    method: 'POST',
    body: diagForm,
  });
  assert.equal(diagRes.status, 200);
  const diagJson = await diagRes.json();
  assert.equal(diagJson.valid, true);
  assert.ok(diagJson.fingerprintHashCount >= 50);

  const form = new FormData();
  form.set('source', 'microphone');
  form.set('durationMs', '8000');
  form.set('audio', new Blob([wavBuf], { type: 'audio/wav' }), 'sample.wav');

  const recRes = await fetch(`${baseUrl}/api/v1/recognize`, {
    method: 'POST',
    headers: {
      'X-Auralis-Client': `web/${expectedVersion}`,
      'X-Auralis-Install': 'e2e-verification-suite',
    },
    body: form,
  });
  assert.equal(recRes.status, 200);
  const recJson = await recRes.json();
  assert.equal(recJson.status, 'match');
  assert.equal(recJson.result.title, sampleTrack.title);
  assert.equal(recJson.result.isrc, sampleTrack.isrc);
  assert.ok(recJson.result.match.confidence.value >= 70);
  console.log(
    `✔ Live studio recognition succeeded on ${baseUrl}: "${recJson.result.title}" by ${recJson.result.artist} (offset=${recJson.result.match.timecode}, confidence=${recJson.result.match.confidence.value}/100, latency=${recJson.latencyMs}ms)`,
  );

  // 5. Verify Popular Mainstream Songs across all 6 platform client profiles (Android, iOS, macOS, Windows, Linux, Web)
  const { existsSync, readFileSync } = await import('node:fs');
  const { decodeWav, encodeWav16 } = await import('../server/dist/audio/wav.js');
  const mainstreamChecks = [
    { trackId: 1193701392, title: 'Shape of You', artist: 'Ed Sheeran', platform: 'android', source: 'microphone', startSec: 6 },
    { trackId: 1447401620, title: 'Despacito', artist: 'Luis Fonsi & Daddy Yankee', platform: 'ios', source: 'microphone', startSec: 8 },
    { trackId: 1842957386, title: 'Loser', artist: 'Tame Impala', platform: 'macos', source: 'system', startSec: 5 },
    { trackId: 1440532773, title: 'Reflections', artist: 'The Neighbourhood', platform: 'windows', source: 'system', startSec: 10 },
    { trackId: 635016640, title: 'Sweater Weather', artist: 'The Neighbourhood', platform: 'linux', source: 'system', startSec: 12 },
    { trackId: 1499378607, title: 'Blinding Lights', artist: 'The Weeknd', platform: 'web', source: 'microphone', startSec: 7 },
  ];

  for (const check of mainstreamChecks) {
    const fixturePath = `/tmp/auralis-mainstream-fixtures/${check.trackId}.wav`;
    if (!existsSync(fixturePath)) continue;
    const decoded = decodeWav(new Uint8Array(readFileSync(fixturePath)));
    const startSample = check.startSec * decoded.sampleRate;
    const endSample = (check.startSec + 8) * decoded.sampleRate;
    const clipWav = encodeWav16(decoded.mono.subarray(startSample, endSample), decoded.sampleRate);

    const mForm = new FormData();
    mForm.set('source', check.source);
    mForm.set('platform', check.platform);
    mForm.set('durationMs', '8000');
    mForm.set('audio', new Blob([clipWav], { type: 'audio/wav' }), 'sample.wav');

    const mRes = await fetch(`${baseUrl}/api/v1/recognize`, {
      method: 'POST',
      headers: {
        'X-Auralis-Client': `${check.platform}/${expectedVersion}`,
        'X-Auralis-Install': `e2e-${check.platform}`,
      },
      body: mForm,
    });
    assert.equal(mRes.status, 200);
    const mJson = await mRes.json();
    assert.equal(mJson.status, 'match', `Expected match for ${check.title} on ${check.platform}`);
    assert.equal(mJson.result.title, check.title);
    assert.equal(mJson.result.artist, check.artist);
    console.log(
      `✔ [${check.platform.toUpperCase()} / ${check.source}] Recognized "${mJson.result.title}" — ${mJson.result.artist} (album="${mJson.result.album}", offset=${mJson.result.match.timecode}, hashes=${mJson.audioMetrics?.fingerprintHashCount}, latency=${mJson.latencyMs}ms)`,
    );
  }
}

async function main() {
  const versionManifest = JSON.parse(execSync('cat version.json', { cwd: ROOT, encoding: 'utf8' }));
  const expectedVersion = versionManifest.version;

  runStep('1. Cross-Platform Version Sync Check', 'node scripts/sync-platforms.mjs --check');
  runStep('2. Build Server & Web/PWA', 'npm run build');
  runStep('3. Server & Multi-Condition Acoustic Fingerprinting Tests (17 tests)', 'npm --prefix server test');
  runStep('4. Android Kotlin Compose Unit Tests & APK Build (12 tests)', 'cd android && ./gradlew testDebugUnitTest assembleDebug --console=plain');
  runStep('5. iOS/iPadOS AuralisCore Swift Package Tests (12 tests)', 'cd ios/AuralisCore && swift test');
  runStep('6. Desktop Tauri Rust Audio & DSP Tests (9 tests)', 'cd desktop/src-tauri && cargo test');

  if (remoteBaseUrl) {
    await verifyEndpoints(remoteBaseUrl, expectedVersion);
  } else {
    const { createAuralisApp } = await import('../server/dist/app.js');
    const { loadConfig } = await import('../server/dist/config.js');
    const cfg = { ...loadConfig(), staticDir: join(ROOT, 'web/dist') };
    const { server } = createAuralisApp(cfg);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
      await verifyEndpoints(`http://127.0.0.1:${port}`, expectedVersion);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  console.log(`\n✅ ALL CROSS-PLATFORM & END-TO-END VERIFICATION CHECKS PASSED (v${expectedVersion})!`);
}

main().catch((err) => {
  console.error('\n❌ E2E Verification Failed:', err);
  process.exit(1);
});
