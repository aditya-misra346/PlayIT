import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { analyze, decodeWav, encodeWav16, resample } from '../src/audio/wav.js';
import { createAuralisApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import { FP_SAMPLE_RATE, getDefaultReferenceCatalog, getMainstreamCatalogTracks, REFERENCE_SONGS, synthesizeReferenceSong } from '../src/fingerprint/referenceCatalog.js';
import { ACRCloudProvider } from '../src/providers/acrcloud.js';
import { AudDProvider } from '../src/providers/audd.js';
import { LocalCatalogProvider } from '../src/providers/local.js';
import { RecognitionOrchestrator } from '../src/providers/orchestrator.js';
import { issueShazamKitDeveloperToken } from '../src/providers/shazamkitToken.js';
import type { ProviderId, RecognitionProvider } from '../src/types.js';

function sliceSong(pcm: Float32Array, startSec: number, durationSec: number, sampleRate = FP_SAMPLE_RATE): Float32Array {
  const s = Math.floor(startSec * sampleRate);
  const e = Math.min(pcm.length, Math.floor((startSec + durationSec) * sampleRate));
  return pcm.subarray(s, e);
}

/** Deterministic PRNG for repeatable noise tests. */
function makeNoise(length: number, amplitude: number, seed = 42): Float32Array {
  let s = seed >>> 0;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    out[i] = ((s / 0xffffffff) * 2 - 1) * amplitude;
  }
  return out;
}

/** Simulate external laptop/phone speaker coloration (high-pass ~220 Hz + low-pass ~4200 Hz + mild soft saturation). */
function simulateExternalSpeaker(input: Float32Array, sampleRate = FP_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(input.length);
  const rcHp = 1 / (2 * Math.PI * 220);
  const dt = 1 / sampleRate;
  const alphaHp = rcHp / (rcHp + dt);
  const rcLp = 1 / (2 * Math.PI * 4200);
  const alphaLp = dt / (rcLp + dt);

  let hpPrev = 0;
  let inPrev = 0;
  let lpPrev = 0;
  for (let i = 0; i < input.length; i++) {
    const x = Math.tanh(input[i] * 1.35);
    hpPrev = alphaHp * (hpPrev + x - inPrev);
    inPrev = x;
    lpPrev = lpPrev + alphaLp * (hpPrev - lpPrev);
    out[i] = lpPrev;
  }
  return out;
}

/** Simulate room reverberation / echo with two reflections (65 ms @ 0.35, 145 ms @ 0.20). */
function simulateRoomEcho(input: Float32Array, sampleRate = FP_SAMPLE_RATE): Float32Array {
  const out = new Float32Array(input.length);
  const d1 = Math.floor(0.065 * sampleRate);
  const d2 = Math.floor(0.145 * sampleRate);
  for (let i = 0; i < input.length; i++) {
    let v = input[i];
    if (i >= d1) v += 0.35 * input[i - d1];
    if (i >= d2) v += 0.2 * input[i - d2];
    out[i] = Math.max(-0.98, Math.min(0.98, v));
  }
  return out;
}

describe('1. Audio Preprocessing, Quality Gate & WAV Codec', () => {
  it('encodes and decodes 16-bit PCM WAV accurately and computes RMS/clipping/silence metrics', () => {
    const sr = 16000;
    const sine = new Float32Array(sr * 5);
    for (let i = 0; i < sine.length; i++) {
      sine[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    const wav = encodeWav16(sine, sr);
    const decoded = decodeWav(wav);
    assert.equal(decoded.sampleRate, sr);
    assert.equal(decoded.channels, 1);
    assert.ok(Math.abs(decoded.durationMs - 5000) < 5);

    const metrics = analyze(decoded.mono, sr);
    // 0.5 amplitude sine has RMS = 0.5 / sqrt(2) = 0.3535 -> -9.03 dBFS
    assert.ok(Math.abs(metrics.rmsDbfs - -9.03) < 0.2, `Expected ~-9.03 dBFS, got ${metrics.rmsDbfs}`);
    assert.equal(metrics.clippingRatio, 0);
    assert.equal(metrics.silenceRatio, 0);
  });

  it('detects silence and clipping ratios accurately', () => {
    const sr = 16000;
    const silent = new Float32Array(sr * 5);
    const silentMetrics = analyze(silent, sr);
    assert.ok(silentMetrics.rmsDbfs <= -100);
    assert.equal(silentMetrics.silenceRatio, 1);

    const clipped = new Float32Array(sr * 2);
    for (let i = 0; i < clipped.length; i++) {
      clipped[i] = i % 2 === 0 ? 0.995 : -0.995;
    }
    const clipMetrics = analyze(clipped, sr);
    assert.equal(clipMetrics.clippingRatio, 1);
  });

  it('resamples from 48 kHz to 16 kHz preserving spectral fundamental', () => {
    const inSr = 48000;
    const outSr = 16000;
    const sig = new Float32Array(inSr * 2);
    for (let i = 0; i < sig.length; i++) {
      sig[i] = 0.7 * Math.sin((2 * Math.PI * 1000 * i) / inSr);
    }
    const resampled = resample(sig, inSr, outSr);
    assert.equal(resampled.length, outSr * 2);
    const m = analyze(resampled, outSr);
    assert.ok(m.rmsDbfs > -7 && m.rmsDbfs < -5.5);
  });
});

describe('2. Multi-Condition Acoustic Fingerprinting Accuracy Suite', () => {
  const catalog = getDefaultReferenceCatalog();

  it('identifies all 8 reference tracks under clean studio conditions (100% accuracy)', () => {
    for (const spec of REFERENCE_SONGS) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const clip = sliceSong(full, 4.0, 8.0);
      const match = catalog.match(clip, FP_SAMPLE_RATE, 20);
      assert.ok(match, `Expected match for "${spec.meta.title}"`);
      assert.equal(match.track.id, spec.meta.id);
      assert.equal(match.track.title, spec.meta.title);
      assert.equal(match.track.artists[0], spec.meta.artists[0]);
      // Offset should be close to 4000 ms (+/- 200 ms)
      assert.ok(
        Math.abs(match.offsetMs - 4000) <= 250,
        `Expected offset ~4000ms for ${spec.meta.title}, got ${match.offsetMs}ms`,
      );
      assert.ok(match.confidence >= 70 && match.confidence <= 100);
    }
  });

  it('identifies songs already in progress at arbitrary offsets (e.g. t=9.5s) and reports accurate offsetMs', () => {
    for (const spec of REFERENCE_SONGS.slice(0, 4)) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const clip = sliceSong(full, 9.5, 8.0);
      const match = catalog.match(clip, FP_SAMPLE_RATE, 20);
      assert.ok(match);
      assert.equal(match.track.id, spec.meta.id);
      assert.ok(Math.abs(match.offsetMs - 9500) <= 250, `Expected ~9500ms, got ${match.offsetMs}ms`);
    }
  });

  it('identifies music playing through simulated external speakers (band-limited 220-4200Hz + saturation)', () => {
    for (const spec of REFERENCE_SONGS) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const clip = simulateExternalSpeaker(sliceSong(full, 3.0, 9.0));
      const match = catalog.match(clip, FP_SAMPLE_RATE, 20);
      assert.ok(match, `Failed external speaker test for ${spec.meta.title}`);
      assert.equal(match.track.id, spec.meta.id);
    }
  });

  it('identifies music in noisy environments (additive background noise)', () => {
    for (const spec of REFERENCE_SONGS) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const clean = sliceSong(full, 5.0, 9.0);
      const noise = makeNoise(clean.length, 0.14, 101);
      const noisy = new Float32Array(clean.length);
      for (let i = 0; i < clean.length; i++) noisy[i] = clean[i] + noise[i];

      const match = catalog.match(noisy, FP_SAMPLE_RATE, 18);
      assert.ok(match, `Failed noisy environment test for ${spec.meta.title}`);
      assert.equal(match.track.id, spec.meta.id);
    }
  });

  it('identifies music with moderate room echo / reverberation', () => {
    for (const spec of REFERENCE_SONGS) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const echoed = simulateRoomEcho(sliceSong(full, 2.0, 9.0));
      const match = catalog.match(echoed, FP_SAMPLE_RATE, 18);
      assert.ok(match, `Failed room echo test for ${spec.meta.title}`);
      assert.equal(match.track.id, spec.meta.id);
    }
  });

  it('identifies low-volume music (-30 dB attenuation) and short 4.5-second clips', () => {
    for (const spec of REFERENCE_SONGS.slice(0, 5)) {
      const full = synthesizeReferenceSong(spec, 24, FP_SAMPLE_RATE);
      const shortQuiet = sliceSong(full, 6.0, 4.5).map((x) => x * 0.03) as Float32Array;
      const match = catalog.match(shortQuiet, FP_SAMPLE_RATE, 15);
      assert.ok(match, `Failed short low-volume clip for ${spec.meta.title}`);
      assert.equal(match.track.id, spec.meta.id);
    }
  });

  it('maintains 0% false positive rate on non-catalog audio and random noise (honest no-match)', () => {
    // 1. Pure white noise
    const noise = makeNoise(FP_SAMPLE_RATE * 8, 0.4, 999);
    assert.equal(catalog.match(noise, FP_SAMPLE_RATE, 20), null);

    // 2. Unrelated synthesized melody with unindexed intervals/frequencies
    const unrelated = new Float32Array(FP_SAMPLE_RATE * 8);
    for (let i = 0; i < unrelated.length; i++) {
      const t = i / FP_SAMPLE_RATE;
      const f = 313 + ((Math.floor(t * 7) * 89) % 900);
      unrelated[i] = 0.4 * Math.sin(2 * Math.PI * f * t);
    }
    assert.equal(catalog.match(unrelated, FP_SAMPLE_RATE, 20), null);
  });

  it('loads all 75 mainstream commercial tracks across all genres and decades alongside the 8 studio reference tracks', () => {
    const mainstream = getMainstreamCatalogTracks();
    assert.equal(mainstream.length, 75);
    assert.equal(catalog.size, 83);
    const requiredGenres = [
      'Pop',
      'Hip-Hop',
      'Rap',
      'Rock',
      'Alternative',
      'Electronic',
      'Dance',
      'R&B',
      'Bollywood',
      'Indian Regional',
      'Classical',
      'Instrumental',
      'Acoustic',
    ];
    for (const g of requiredGenres) {
      assert.ok(
        mainstream.some((t) => t.genres.includes(g)),
        `Expected mainstream catalog to include genre "${g}"`,
      );
    }
    const mustInclude = ['Shape of You', 'Despacito', 'Loser', 'Reflections', 'Anti-Hero', 'Bohemian Rhapsody'];
    for (const title of mustInclude) {
      assert.ok(
        mainstream.some((t) => t.title === title),
        `Expected mainstream catalog to include "${title}"`,
      );
    }
  });
});

describe('3. Commercial Provider Adapters (AudD, ACRCloud, ShazamKit Token) & Failure Modes', () => {
  it('AudDProvider normalizes track metadata without fabricating confidence and maps error codes', async () => {
    const fakeWav = encodeWav16(makeNoise(16000 * 5, 0.2), 16000);
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          result: {
            artist: 'Daft Punk',
            title: 'Get Lucky',
            album: 'Random Access Memories',
            release_date: '2013-04-19',
            label: 'Columbia',
            timecode: '01:24',
            song_link: 'https://lis.tn/GetLucky',
            apple_music: {
              url: 'https://music.apple.com/us/album/get-lucky/617154241',
              isrc: 'USQX91300108',
              genreNames: ['Pop', 'Music'],
              durationInMillis: 369000,
              artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg', width: 1400, height: 1400 },
            },
            spotify: {
              id: '69kOkLUCkxIZYexIgSG8rq',
              external_urls: { spotify: 'https://open.spotify.com/track/69kOkLUCkxIZYexIgSG8rq' },
            },
          },
        }),
        { status: 200 },
      );

    const audd = new AudDProvider(
      { token: 'test-token', endpoint: 'https://api.audd.io/', costPerRequestUsd: 0.005 },
      mockFetch,
    );
    const res = await audd.recognize(
      fakeWav,
      { source: 'microphone', platform: 'web', durationMs: 5000, requestId: 'req-1' },
      new AbortController().signal,
    );
    assert.equal(res.status, 'match');
    assert.equal(res.result.title, 'Get Lucky');
    assert.equal(res.result.artist, 'Daft Punk');
    assert.equal(res.result.isrc, 'USQX91300108');
    assert.equal(res.result.match.offsetMs, 84000);
    assert.equal(res.result.match.timecode, '01:24');
    assert.equal(res.result.match.confidence, null, 'AudD must never fabricate a confidence score');
    assert.ok(res.result.links.some((l) => l.service === 'spotify'));
    assert.ok(res.result.links.some((l) => l.service === 'apple_music'));

    // Quota exceeded error code 901
    const quotaFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ status: 'error', error: { error_code: 901, error_message: 'No requests left' } }), {
        status: 200,
      });
    const auddQuota = new AudDProvider(
      { token: 'test-token', endpoint: 'https://api.audd.io/', costPerRequestUsd: 0.005 },
      quotaFetch,
    );
    await assert.rejects(
      () =>
        auddQuota.recognize(
          fakeWav,
          { source: 'microphone', platform: 'web', durationMs: 5000, requestId: 'req-2' },
          new AbortController().signal,
        ),
      (err: unknown) => err instanceof ApiError && err.code === 'PROVIDER_QUOTA',
    );
  });

  it('ACRCloudProvider computes HMAC-SHA1 signature, preserves real score, and maps error codes', async () => {
    const fakeWav = encodeWav16(makeNoise(16000 * 5, 0.2), 16000);
    const mockFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          status: { msg: 'Success', code: 0 },
          metadata: {
            music: [
              {
                acrid: 'acr-123',
                title: 'Starboy',
                artists: [{ name: 'The Weeknd' }, { name: 'Daft Punk' }],
                album: { name: 'Starboy' },
                release_date: '2016-11-25',
                score: 94,
                play_offset_ms: 42500,
                external_ids: { isrc: 'USUG11600976' },
                external_metadata: {
                  spotify: { track: { id: '7MXVkk9YMctZqd1Srtv4MB' } },
                  youtube: { vid: '34Na4j8AVgA' },
                },
              },
            ],
          },
        }),
        { status: 200 },
      );

    const acr = new ACRCloudProvider(
      {
        host: 'identify-eu-west-1.acrcloud.com',
        accessKey: 'ak-test',
        accessSecret: 'as-secret',
        costPerRequestUsd: 0.006,
      },
      mockFetch,
      () => 1700000000000,
    );
    assert.equal(acr.sign('1700000000'), '5yWh65agpnvXdPwqNadmJy4UfIc=');

    const res = await acr.recognize(
      fakeWav,
      { source: 'microphone', platform: 'web', durationMs: 5000, requestId: 'req-3' },
      new AbortController().signal,
    );
    assert.equal(res.status, 'match');
    assert.equal(res.result.title, 'Starboy');
    assert.equal(res.result.artist, 'The Weeknd, Daft Punk');
    assert.deepEqual(res.result.match.confidence, { value: 94, scale: 100 });
    assert.equal(res.result.match.offsetMs, 42500);
    assert.ok(res.result.links.some((l) => l.service === 'spotify'));
    assert.ok(res.result.links.some((l) => l.service === 'youtube'));
  });

  it('issues valid ES256 ShazamKit Developer Tokens verifiable with the EC P-256 public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const { token } = issueShazamKitDeveloperToken(
      { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKeyPem: pem, tokenTtlSec: 1800 },
      1700000000000,
    );
    const parts = token.split('.');
    assert.equal(parts.length, 3);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.equal(header.alg, 'ES256');
    assert.equal(header.kid, 'KEY1234567');
    assert.equal(payload.iss, 'TEAM123456');
    assert.equal(payload.exp - payload.iat, 1800);

    const pub = createPublicKey(publicKey.export({ type: 'spki', format: 'pem' }));
    const isValid = verify(
      'sha256',
      Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'),
      { key: pub, dsaEncoding: 'ieee-p1363' },
      Buffer.from(parts[2], 'base64url'),
    );
    assert.equal(isValid, true);
  });

  it('Orchestrator falls back to secondary provider when primary provider fails with quota or service error', async () => {
    const failingPrimary: RecognitionProvider = {
      id: 'audd',
      name: 'AudD',
      suppliesConfidence: false,
      costPerRequestUsd: 0.005,
      isConfigured: () => true,
      recognize: async () => {
        throw new ApiError('PROVIDER_QUOTA', 'Quota exceeded');
      },
    };
    const localSecondary = new LocalCatalogProvider({ enabled: true, catalogPath: '', minScore: 20 });
    const orchestrator = new RecognitionOrchestrator({
      providers: new Map<ProviderId, RecognitionProvider>([
        ['audd', failingPrimary],
        ['local', localSecondary],
      ]),
      providerOrder: ['audd', 'local'],
      fallbackOnNoMatch: false,
      minSeconds: 3,
      maxSeconds: 15,
      maxUploadBytes: 1024 * 1024,
      providerTimeoutMs: 5000,
      dailyBudgetRequests: 1000,
    });

    const songPcm = sliceSong(synthesizeReferenceSong(REFERENCE_SONGS[0], 24, FP_SAMPLE_RATE), 2, 8);
    const wav = encodeWav16(songPcm, FP_SAMPLE_RATE);
    const res = await orchestrator.recognize(wav, {
      source: 'microphone',
      platform: 'web',
      durationMs: 8000,
      requestId: 'req-fallback',
    });
    assert.equal(res.status, 'match');
    assert.equal(res.provider.id, 'local');
    assert.equal(res.result?.title, REFERENCE_SONGS[0].meta.title);
  });

  it('Orchestrator rejects silent audio (AUDIO_SILENT) and too-short clips (AUDIO_TOO_SHORT) before calling providers', async () => {
    let called = false;
    const spyProvider: RecognitionProvider = {
      id: 'audd',
      name: 'AudD',
      suppliesConfidence: false,
      costPerRequestUsd: 0.005,
      isConfigured: () => true,
      recognize: async () => {
        called = true;
        return { status: 'no_match' };
      },
    };
    const orchestrator = new RecognitionOrchestrator({
      providers: new Map([['audd', spyProvider]]),
      providerOrder: ['audd'],
      fallbackOnNoMatch: false,
      minSeconds: 3,
      maxSeconds: 15,
      maxUploadBytes: 1024 * 1024,
      providerTimeoutMs: 5000,
      dailyBudgetRequests: 1000,
    });

    const silentWav = encodeWav16(new Float32Array(16000 * 5), 16000);
    await assert.rejects(
      () => orchestrator.recognize(silentWav, { source: 'microphone', platform: 'web', durationMs: 5000, requestId: 'r1' }),
      (e: unknown) => e instanceof ApiError && e.code === 'AUDIO_SILENT',
    );
    assert.equal(called, false, 'Provider must not be called for silent audio');

    const shortWav = encodeWav16(makeNoise(16000 * 1, 0.3), 16000);
    await assert.rejects(
      () => orchestrator.recognize(shortWav, { source: 'microphone', platform: 'web', durationMs: 1000, requestId: 'r2' }),
      (e: unknown) => e instanceof ApiError && e.code === 'AUDIO_TOO_SHORT',
    );
    assert.equal(called, false, 'Provider must not be called for too-short audio');
  });
});

describe('4. End-to-End HTTP API Server (Config, Multipart Recognition, Auth, Library Sync & Deletion)', () => {
  it('serves config, identifies multipart WAV uploads, syncs library, and deletes user data cleanly', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'auralis-test-'));
    try {
      const cfg = {
        ...loadConfig(),
        dataDir: tmp,
        providerOrder: ['local'] as ProviderId[],
      };
      const { server } = createAuralisApp(cfg);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const addr = server.address() as { port: number };
      const base = `http://127.0.0.1:${addr.port}`;

      // 1. GET /api/v1/config
      const cfgRes = await fetch(`${base}/api/v1/config`);
      assert.equal(cfgRes.status, 200);
      const cfgJson: any = await cfgRes.json();
      assert.ok(Array.isArray(cfgJson.providers));
      assert.equal(cfgJson.capture.sampleRate, 16000);

      // 2. POST /api/v1/recognize (multipart/form-data) with Reference Song #2
      const targetSpec = REFERENCE_SONGS[1];
      const clip = sliceSong(synthesizeReferenceSong(targetSpec, 24, FP_SAMPLE_RATE), 5.0, 8.0);
      const wav = encodeWav16(clip, FP_SAMPLE_RATE);
      const form = new FormData();
      form.set('source', 'microphone');
      form.set('durationMs', '8000');
      form.set('audio', new Blob([wav], { type: 'audio/wav' }), 'sample.wav');

      const recRes = await fetch(`${base}/api/v1/recognize`, {
        method: 'POST',
        headers: { 'X-Auralis-Client': 'web/1.0', 'X-Auralis-Install': 'test-install-uuid-1234' },
        body: form,
      });
      assert.equal(recRes.status, 200);
      const recJson: any = await recRes.json();
      assert.equal(recJson.status, 'match');
      assert.equal(recJson.result.title, targetSpec.meta.title);
      assert.equal(recJson.result.artist, targetSpec.meta.artists.join(', '));

      // 2b. POST /api/v1/diagnostics/audio (Phase 3 diagnostic verification)
      const diagForm = new FormData();
      diagForm.set('source', 'microphone');
      diagForm.set('durationMs', '8000');
      diagForm.set('audio', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'sample.wav');
      const diagRes = await fetch(`${base}/api/v1/diagnostics/audio`, {
        method: 'POST',
        body: diagForm,
      });
      assert.equal(diagRes.status, 200);
      const diagJson: any = await diagRes.json();
      assert.equal(diagJson.valid, true);
      assert.equal(diagJson.checks.signalDetected, true);
      assert.equal(diagJson.checks.levelSufficient, true);
      assert.equal(diagJson.checks.durationSufficient, true);
      assert.equal(diagJson.checks.encodedValid, true);
      assert.equal(diagJson.checks.fingerprintReady, true);
      assert.ok(diagJson.fingerprintHashCount >= 50);

      // 3. Register account, sync library item, fetch library, delete account
      const regRes = await fetch(`${base}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'listener@auralis.app', password: 'correct-horse-battery' }),
      });
      assert.equal(regRes.status, 201);
      const { token } = (await regRes.json()) as { token: string };

      const syncRes = await fetch(`${base}/api/v1/library/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          items: [
            {
              id: 'item-1',
              track: recJson.result,
              favorite: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      assert.equal(syncRes.status, 200);
      const syncJson: any = await syncRes.json();
      assert.equal(syncJson.items.length, 1);
      assert.equal(syncJson.items[0].track.title, targetSpec.meta.title);

      const delRes = await fetch(`${base}/api/v1/account`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(delRes.status, 200);

      await new Promise<void>((resolve) => server.close(() => resolve()));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
