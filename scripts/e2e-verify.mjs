#!/usr/bin/env node
/**
 * PlayIT End-to-End Verification Suite (`scripts/e2e-verify.mjs`)
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
  PATH: `${process.env.HOME}/.local/toolchains/node/bin:/Users/aditya/.gemini/antigravity/scratch/tools/node-v22.14.0-darwin-arm64/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
};

function runStep(title, cmd) {
  console.log(`\n━━━ [VERIFY] ${title} ━━━`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env });
}

async function verifyEndpoints(baseUrl, expectedVersion) {
  console.log(`\n━━━ [VERIFY] Live Endpoint & Recognition Check against ${baseUrl} ━━━`);

  const htmlRes = await fetch(`${baseUrl}/`);
  assert.equal(htmlRes.status, 200, 'Expected HTTP 200 on /');
  const html = await htmlRes.text();
  assert.ok(html.includes('PlayIT'), 'Expected PlayIT title in index.html');

  const verRes = await fetch(`${baseUrl}/api/v1/version`);
  assert.equal(verRes.status, 200, 'Expected HTTP 200 on /api/v1/version');
  const verJson = await verRes.json();
  assert.equal(verJson.version, expectedVersion, 'Expected /api/v1/version to match version.json');

  const cfgRes = await fetch(`${baseUrl}/api/v1/config`);
  assert.equal(cfgRes.status, 200);
  const cfgJson = await cfgRes.json();
  assert.equal(cfgJson.version, expectedVersion);
  assert.ok(Array.isArray(cfgJson.providers) && cfgJson.providers.length > 0);

  const refRes = await fetch(`${baseUrl}/api/v1/reference-tracks`);
  assert.equal(refRes.status, 200);
  const refJson = await refRes.json();
  assert.ok(refJson.tracks.length >= 58, `Expected >= 58 tracks, got ${refJson.tracks.length}`);

  const sampleTrack = refJson.tracks.find((t) => t.category === 'studio') ?? refJson.tracks[refJson.tracks.length - 1];
  const wavRes = await fetch(`${baseUrl}${sampleTrack.audioUrl}?startSec=5&durationSec=8`);
  assert.equal(wavRes.status, 200);
  const wavBuf = new Uint8Array(await wavRes.arrayBuffer());

  const form = new FormData();
  form.set('source', 'microphone');
  form.set('durationMs', '8000');
  form.set('audio', new Blob([wavBuf], { type: 'audio/wav' }), 'sample.wav');

  const recRes = await fetch(`${baseUrl}/api/v1/recognize`, {
    method: 'POST',
    headers: {
      'X-PlayIT-Client': `web/${expectedVersion}`,
      'X-PlayIT-Install': 'e2e-verification-suite',
    },
    body: form,
  });
  assert.equal(recRes.status, 200);
  const recJson = await recRes.json();
  assert.equal(recJson.status, 'match');
  assert.equal(recJson.result.title, sampleTrack.title);
  console.log(
    `✔ Live studio recognition succeeded on ${baseUrl}: "${recJson.result.title}" by ${recJson.result.artist}`,
  );
}

async function main() {
  const versionManifest = JSON.parse(execSync('cat version.json', { cwd: ROOT, encoding: 'utf8' }));
  const expectedVersion = versionManifest.version;

  runStep('1. Version Sync Check', 'node scripts/sync-platforms.mjs --check');
  runStep('2. Build Server & Web', 'npm run build');
  runStep('3. Server & Multi-Condition Acoustic Fingerprinting Tests', 'npm --prefix server test');

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

  console.log(`\n✅ ALL END-TO-END VERIFICATION CHECKS PASSED (v${expectedVersion})!`);
}

main().catch((err) => {
  console.error('\n❌ E2E Verification Failed:', err);
  process.exit(1);
});
