import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { encodeWav16 } from './audio/wav.js';
import type { AppConfig } from './config.js';
import { ApiError } from './errors.js';
import { getMainstreamCatalogTracks, REFERENCE_SONGS, synthesizeReferenceSong } from './fingerprint/referenceCatalog.js';
import { ACRCloudProvider } from './providers/acrcloud.js';
import { AudDProvider } from './providers/audd.js';
import { LocalCatalogProvider } from './providers/local.js';
import { RecognitionOrchestrator } from './providers/orchestrator.js';
import { issueShazamKitDeveloperToken } from './providers/shazamkitToken.js';
import { RateLimiter } from './rateLimit.js';
import { AuralisStore } from './store.js';
import type { CaptureSource, ProviderId, RecognitionProvider } from './types.js';
import { RELEASE_MANIFEST } from './version.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
};

export function createAuralisApp(cfg: AppConfig, fetchImpl: typeof fetch = fetch) {
  const store = new AuralisStore(cfg.dataDir, process.env.SESSION_SECRET ?? 'auralis-dev-secret-key-32-bytes');
  const rateLimiter = new RateLimiter({
    perMinute: cfg.limits.perMinute,
    perDay: cfg.limits.perDay,
    perDayAnonymous: cfg.limits.perDayAnonymous,
  });

  const audd = new AudDProvider(cfg.audd, fetchImpl);
  const acrcloud = new ACRCloudProvider(cfg.acrcloud, fetchImpl);
  const local = new LocalCatalogProvider(cfg.local);

  const providers = new Map<ProviderId, RecognitionProvider>([
    ['acrcloud', acrcloud],
    ['audd', audd],
    ['local', local],
  ]);

  const orchestrator = new RecognitionOrchestrator(
    {
      providers,
      providerOrder: cfg.providerOrder,
      fallbackOnNoMatch: cfg.fallbackOnNoMatch,
      minSeconds: cfg.limits.minSeconds,
      maxSeconds: cfg.limits.maxSeconds,
      maxUploadBytes: cfg.limits.maxUploadBytes,
      providerTimeoutMs: cfg.limits.providerTimeoutMs,
      dailyBudgetRequests: cfg.limits.dailyBudgetRequests,
      onProviderCall: (providerId, status, costUsd, latencyMs) => {
        store.recordProviderUsage(providerId, status, costUsd, latencyMs);
      },
      getTodayPaidRequests: () => store.getTodayPaidRequests(),
    },
    fetchImpl,
  );

  function setSecurityAndCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (origin && (cfg.corsOrigins.includes('*') || cfg.corsOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else if (!cfg.isProd) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Auralis-Client, X-Auralis-Install');
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After, X-Request-Id');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, extraHeaders?: Record<string, string>): void {
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
    }
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(payload);
  }

  async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.byteLength;
      if (total > maxBytes) {
        throw new ApiError('PAYLOAD_TOO_LARGE', `Request body exceeds maximum size of ${maxBytes} bytes.`);
      }
      chunks.push(b);
    }
    return Buffer.concat(chunks);
  }

  async function readJsonBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<any> {
    const buf = await readRawBody(req, maxBytes);
    if (buf.byteLength === 0) return {};
    try {
      return JSON.parse(buf.toString('utf8'));
    } catch {
      throw new ApiError('BAD_REQUEST', 'Request body must be valid JSON.');
    }
  }

  function getAuthUser(req: IncomingMessage): { id: string; email: string } | null {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return null;
    return store.verifyToken(header.slice(7).trim());
  }

  function getIdentityKey(req: IncomingMessage, userId?: string): string {
    if (userId) return `user:${userId}`;
    const installId = String(req.headers['x-auralis-install'] ?? '').trim();
    if (installId && installId.length >= 8 && installId.length <= 80) {
      return `install:${installId}`;
    }
    const forwarded = cfg.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    const ip = forwarded || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }

  async function parseRecognizeInput(
    req: IncomingMessage,
  ): Promise<{ wav: Uint8Array; source: CaptureSource; durationMs: number; provider?: ProviderId }> {
    const contentType = String(req.headers['content-type'] ?? '');
    if (contentType.includes('multipart/form-data')) {
      const raw = await readRawBody(req, cfg.limits.maxUploadBytes + 64 * 1024);
      const webReq = new Request('http://localhost/api/v1/recognize', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body: new Uint8Array(raw) as unknown as BodyInit,
      });
      let form: FormData;
      try {
        form = await webReq.formData();
      } catch {
        throw new ApiError('BAD_REQUEST', 'Invalid multipart/form-data payload.');
      }
      const audioEntry = form.get('audio') ?? form.get('file');
      if (!audioEntry || typeof audioEntry === 'string') {
        throw new ApiError('BAD_REQUEST', 'Missing "audio" WAV file field in multipart request.');
      }
      const ab = await (audioEntry as Blob).arrayBuffer();
      const sourceRaw = String(form.get('source') ?? 'microphone');
      const source: CaptureSource =
        sourceRaw === 'system' || sourceRaw === 'file' ? sourceRaw : 'microphone';
      const durationMs = Number(form.get('durationMs')) || 0;
      const provRaw = form.get('provider');
      const provider =
        provRaw === 'audd' || provRaw === 'acrcloud' || provRaw === 'local'
          ? (provRaw as ProviderId)
          : undefined;
      return { wav: new Uint8Array(ab), source, durationMs, provider };
    }

    if (contentType.includes('application/json')) {
      const body = await readJsonBody(req, Math.ceil(cfg.limits.maxUploadBytes * 1.5));
      if (typeof body.wavBase64 !== 'string' || !body.wavBase64) {
        throw new ApiError('BAD_REQUEST', 'Missing "wavBase64" field in JSON body.');
      }
      const wav = new Uint8Array(Buffer.from(body.wavBase64, 'base64'));
      const source: CaptureSource =
        body.source === 'system' || body.source === 'file' ? body.source : 'microphone';
      const durationMs = Number(body.durationMs) || 0;
      const provider =
        body.provider === 'audd' || body.provider === 'acrcloud' || body.provider === 'local'
          ? (body.provider as ProviderId)
          : undefined;
      return { wav, source, durationMs, provider };
    }

    throw new ApiError('UNSUPPORTED_FORMAT', 'Use multipart/form-data (field "audio") or application/json ("wavBase64").');
  }

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setSecurityAndCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    try {
      // 0. Cross-platform version & synchronization manifest
      if (req.method === 'GET' && path === '/api/v1/version') {
        sendJson(res, 200, RELEASE_MANIFEST);
        return;
      }

      // 1. Health & configuration
      if (req.method === 'GET' && path === '/api/v1/health') {
        const providerStatus = orchestrator.listProviderStatus();
        sendJson(res, 200, {
          status: 'ok',
          service: 'auralis-recognition-server',
          version: RELEASE_MANIFEST.version,
          buildNumber: RELEASE_MANIFEST.buildNumber,
          providers: providerStatus,
          referenceCatalogTracks: local.catalogSize,
        });
        return;
      }

      if (req.method === 'GET' && path === '/api/v1/config') {
        const providerStatus = orchestrator.listProviderStatus().filter((p) => p.configured);
        const primary = providerStatus[0];
        const shazamkitConfigured = Boolean(
          cfg.shazamkit.teamId && cfg.shazamkit.keyId && cfg.shazamkit.privateKeyPem,
        );
        const providerNames = providerStatus.map((p) => p.name).join(' / ') || 'configured recognition provider';
        const disclosure =
          primary?.id === 'local' && providerStatus.length === 1
            ? `A short ~${cfg.capture.targetSeconds}-second audio sample is fingerprinted by ${primary.name} to identify the song. Raw audio is immediately discarded and never stored.`
            : `A short ~${cfg.capture.targetSeconds}-second audio sample is transmitted over HTTPS and processed by ${providerNames} to identify the song. Raw audio is never stored.`;

        sendJson(res, 200, {
          version: RELEASE_MANIFEST.version,
          buildNumber: RELEASE_MANIFEST.buildNumber,
          release: RELEASE_MANIFEST,
          providers: providerStatus,
          capture: {
            targetSeconds: cfg.capture.targetSeconds,
            maxSeconds: cfg.capture.maxSeconds,
            minSeconds: cfg.capture.minSeconds,
            sampleRate: cfg.capture.sampleRate,
            maxUploadBytes: cfg.limits.maxUploadBytes,
          },
          disclosure,
          shazamkitTokens: shazamkitConfigured,
          accounts: true,
          referenceCatalogCount: local.catalogSize,
        });
        return;
      }

      // 2. Song Recognition
      if (req.method === 'POST' && path === '/api/v1/recognize') {
        const user = getAuthUser(req);
        const identity = getIdentityKey(req, user?.id);
        rateLimiter.checkAndConsume(identity, Boolean(user));

        const clientHeader = String(req.headers['x-auralis-client'] ?? 'web/1.0');
        const platform = clientHeader.split('/')[0] || 'web';
        const { wav, source, durationMs, provider } = await parseRecognizeInput(req);

        const outcome = await orchestrator.recognize(
          wav,
          {
            source,
            platform,
            durationMs,
            requestId,
          },
          provider,
        );
        sendJson(res, 200, outcome);
        return;
      }

      // 2b. Audio Diagnostic Verification Endpoint (Phase 3)
      if (req.method === 'POST' && path === '/api/v1/diagnostics/audio') {
        const { wav } = await parseRecognizeInput(req);
        const report = orchestrator.inspectAudio(wav);
        sendJson(res, 200, report);
        return;
      }

      // 3. ShazamKit Developer Token endpoint (for Android / Web / iOS clients when configured)
      if (req.method === 'GET' && path === '/api/v1/shazamkit/token') {
        const user = getAuthUser(req);
        rateLimiter.checkAndConsume(getIdentityKey(req, user?.id), Boolean(user));
        const tokenObj = issueShazamKitDeveloperToken(cfg.shazamkit);
        sendJson(res, 200, tokenObj);
        return;
      }

      // 4. Reference & Mainstream Catalog Streaming (for real speaker-to-mic & automated accuracy testing)
      if (req.method === 'GET' && path === '/api/v1/reference-tracks') {
        const mainstreamTracks = getMainstreamCatalogTracks().map((m) => ({
          ...m,
          category: 'mainstream' as const,
          bpm: 120,
          timbre: 'commercial',
          hasVocalsFormant: true,
          audioUrl: `/api/v1/reference-tracks/${encodeURIComponent(m.id)}/audio.wav`,
        }));
        const studioTracks = REFERENCE_SONGS.map((s) => ({
          ...s.meta,
          category: 'studio' as const,
          bpm: s.bpm,
          timbre: s.timbre,
          hasVocalsFormant: s.hasVocalsFormant,
          audioUrl: `/api/v1/reference-tracks/${encodeURIComponent(s.meta.id)}/audio.wav`,
        }));
        sendJson(res, 200, {
          tracks: [...mainstreamTracks, ...studioTracks],
        });
        return;
      }

      const refAudioMatch = path.match(/^\/api\/v1\/reference-tracks\/([^/]+)\/audio(?:\.wav)?$/);
      if (req.method === 'GET' && refAudioMatch) {
        const trackId = decodeURIComponent(refAudioMatch[1]);
        const mainstreamHit = getMainstreamCatalogTracks().find((m) => m.id === trackId || m.isrc === trackId);
        if (mainstreamHit && mainstreamHit.previewUrl) {
          const upstream = await fetchImpl(mainstreamHit.previewUrl);
          if (!upstream.ok) {
            throw new ApiError('PROVIDER_UNAVAILABLE', `Failed to stream preview for "${mainstreamHit.title}".`);
          }
          const ab = await upstream.arrayBuffer();
          res.writeHead(200, {
            'Content-Type': upstream.headers.get('content-type') || 'audio/mp4',
            'Content-Length': String(ab.byteLength),
            'Cache-Control': 'public, max-age=3600',
          });
          res.end(Buffer.from(ab));
          return;
        }
        const spec = REFERENCE_SONGS.find((s) => s.meta.id === trackId || s.meta.isrc === trackId);
        if (!spec) throw new ApiError('NOT_FOUND', `Reference track "${trackId}" not found.`);
        const startSec = Math.max(0, Math.min(18, Number(url.searchParams.get('startSec')) || 0));
        const durSec = Math.max(2, Math.min(24 - startSec, Number(url.searchParams.get('durationSec')) || 24));
        const fullPcm = synthesizeReferenceSong(spec, startSec + durSec, 16000);
        const slice = fullPcm.subarray(Math.floor(startSec * 16000), Math.floor((startSec + durSec) * 16000));
        const wavBytes = encodeWav16(slice, 16000);
        res.writeHead(200, {
          'Content-Type': 'audio/wav',
          'Content-Length': String(wavBytes.byteLength),
          'Cache-Control': 'public, max-age=3600',
        });
        res.end(Buffer.from(wavBytes));
        return;
      }

      // 5. Custom WAV Catalog Ingestion (allows indexing any licensed WAV track into local fingerprint engine)
      if (req.method === 'POST' && path === '/api/v1/catalog/ingest') {
        const body = await readJsonBody(req, 5 * 1024 * 1024);
        if (!body.title || !body.artist || !body.wavBase64) {
          throw new ApiError('BAD_REQUEST', 'Fields "title", "artist", and "wavBase64" are required.');
        }
        const wav = new Uint8Array(Buffer.from(body.wavBase64, 'base64'));
        const { decodeWav } = await import('./audio/wav.js');
        const decoded = decodeWav(wav);
        const id = body.id || `custom:${randomUUID().slice(0, 8)}`;
        const meta = {
          id,
          title: String(body.title).trim(),
          artists: Array.isArray(body.artists) ? body.artists.map(String) : [String(body.artist).trim()],
          album: body.album ? String(body.album) : null,
          releaseDate: body.releaseDate ? String(body.releaseDate) : null,
          genres: Array.isArray(body.genres) ? body.genres.map(String) : [],
          label: body.label ? String(body.label) : null,
          isrc: body.isrc ? String(body.isrc) : null,
          durationMs: Math.round(decoded.durationMs),
          artworkUrl: body.artworkUrl ? String(body.artworkUrl) : null,
          links: Array.isArray(body.links) ? body.links : [],
        };
        const { hashesAdded } = local.ingestTrack(meta, decoded.mono, decoded.sampleRate);
        sendJson(res, 201, { status: 'ingested', id, hashesAdded, catalogSize: local.catalogSize });
        return;
      }

      // 6. Auth & Account Sync
      if (req.method === 'POST' && path === '/api/v1/auth/register') {
        const body = await readJsonBody(req);
        const out = store.registerUser(body.email, body.password);
        sendJson(res, 201, out);
        return;
      }

      if (req.method === 'POST' && path === '/api/v1/auth/login') {
        const body = await readJsonBody(req);
        const out = store.loginUser(body.email, body.password);
        sendJson(res, 200, out);
        return;
      }

      if (req.method === 'GET' && path === '/api/v1/auth/me') {
        const user = getAuthUser(req);
        if (!user) throw new ApiError('UNAUTHORIZED', 'Authentication required.');
        sendJson(res, 200, { user });
        return;
      }

      if (req.method === 'GET' && path === '/api/v1/library') {
        const user = getAuthUser(req);
        if (!user) throw new ApiError('UNAUTHORIZED', 'Sign in to access cloud-synchronized library.');
        const since = url.searchParams.get('since') ?? undefined;
        sendJson(res, 200, store.getLibrary(user.id, since));
        return;
      }

      if (req.method === 'POST' && path === '/api/v1/library/sync') {
        const user = getAuthUser(req);
        if (!user) throw new ApiError('UNAUTHORIZED', 'Sign in to synchronize your library.');
        const body = await readJsonBody(req, 1024 * 1024);
        if (!Array.isArray(body.items)) {
          throw new ApiError('BAD_REQUEST', 'Field "items" must be an array of LibraryItem objects.');
        }
        sendJson(res, 200, store.syncLibrary(user.id, body.items));
        return;
      }

      if (req.method === 'DELETE' && path === '/api/v1/library') {
        const user = getAuthUser(req);
        if (!user) throw new ApiError('UNAUTHORIZED', 'Sign in required.');
        store.clearLibrary(user.id);
        sendJson(res, 200, { status: 'cleared' });
        return;
      }

      if (req.method === 'DELETE' && path === '/api/v1/account') {
        const user = getAuthUser(req);
        if (!user) throw new ApiError('UNAUTHORIZED', 'Sign in required.');
        store.deleteAccount(user.id);
        sendJson(res, 200, { status: 'deleted' });
        return;
      }

      if (req.method === 'GET' && path === '/api/v1/usage') {
        sendJson(res, 200, {
          today: store.getUsageStats(),
          dailyBudgetRequests: cfg.limits.dailyBudgetRequests,
        });
        return;
      }

      // 7. Optional static file serving for production Web + PWA bundle
      if (cfg.staticDir && (req.method === 'GET' || req.method === 'HEAD')) {
        const safeRel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.(\/|\\|$))+/, '');
        let filePath = join(cfg.staticDir, safeRel);
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
          filePath = join(cfg.staticDir, 'index.html');
        }
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const ext = extname(filePath);
          const content = readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
            'Cache-Control': ext === '.html' || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          res.end(req.method === 'HEAD' ? undefined : content);
          return;
        }
      }

      throw new ApiError('NOT_FOUND', `Route ${req.method} ${path} not found.`);
    } catch (err) {
      if (err instanceof ApiError) {
        const headers: Record<string, string> = {};
        if (err.extra.retryAfterSec) {
          headers['Retry-After'] = String(err.extra.retryAfterSec);
        }
        sendJson(res, err.status, err.toJSON(), headers);
        return;
      }
      const internal = new ApiError('INTERNAL', 'An unexpected server error occurred.');
      sendJson(res, 500, internal.toJSON());
    }
  };

  const server = createServer(handleRequest);

  return { server, handleRequest, orchestrator, store, local };
}
