import { createHash } from 'node:crypto';
import type { ProviderId } from './types.js';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number`);
  return n;
}
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === '1' || v.toLowerCase() === 'true';
}
function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig() {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const isVercel = Boolean(process.env.VERCEL);
  const sessionSecret =
    process.env.SESSION_SECRET ||
    createHash('sha256')
      .update(process.env.VERCEL_PROJECT_ID ?? 'auralis-default-session-secret')
      .digest('hex');

  const defaultDataDir = isVercel ? '/tmp/auralis-data' : './data';
  const dataDir = process.env.DATA_DIR ?? defaultDataDir;
  const local = bool('LOCAL_CATALOG_ENABLED', true);

  return {
    nodeEnv,
    isProd,
    isVercel,
    sessionSecret,
    port: num('PORT', 8787),
    host: process.env.HOST ?? '0.0.0.0',
    dataDir,
    corsOrigins: list('CORS_ORIGINS', [
      '*',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]),
    trustProxy: bool('TRUST_PROXY', isVercel),
    /** Ordered provider chain. Local pre-indexed mainstream + reference catalog runs first ($0 cost, <15ms), followed by ACRCloud and AudD commercial catalogs. */
    providerOrder: list('RECOGNITION_PROVIDERS', [...(local ? ['local'] : []), 'acrcloud', 'audd']) as ProviderId[],
    /** Automatically fall through from local fingerprint index to commercial cloud providers (AudD / ACRCloud) on no_match. */
    fallbackOnNoMatch: bool('FALLBACK_ON_NO_MATCH', true),
    audd: {
      token: process.env.AUDD_API_TOKEN || 'test',
      endpoint: process.env.AUDD_ENDPOINT ?? 'https://api.audd.io/',
      costPerRequestUsd: num('AUDD_COST_PER_REQUEST', 0.005),
    },
    acrcloud: {
      host: process.env.ACRCLOUD_HOST ?? '',
      accessKey: process.env.ACRCLOUD_ACCESS_KEY ?? '',
      accessSecret: process.env.ACRCLOUD_ACCESS_SECRET ?? '',
      costPerRequestUsd: num('ACRCLOUD_COST_PER_REQUEST', 0.006),
    },
    local: {
      enabled: local,
      catalogPath: process.env.LOCAL_CATALOG_PATH ?? `${dataDir}/local-catalog.json`,
      /** Minimum aligned-hash votes to declare a match (tuned by test/accuracy). */
      minScore: num('LOCAL_MIN_SCORE', 20),
    },
    shazamkit: {
      teamId: process.env.APPLE_TEAM_ID ?? '',
      keyId: process.env.SHAZAMKIT_KEY_ID ?? '',
      privateKeyPem: (process.env.SHAZAMKIT_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
      tokenTtlSec: num('SHAZAMKIT_TOKEN_TTL', 3600),
    },
    limits: {
      maxUploadBytes: num('MAX_UPLOAD_BYTES', 1024 * 1024),
      minSeconds: num('MIN_SAMPLE_SECONDS', 3),
      maxSeconds: num('MAX_SAMPLE_SECONDS', 20),
      perMinute: num('RATE_LIMIT_PER_MINUTE', 12),
      perDay: num('RATE_LIMIT_PER_DAY', 200),
      perDayAnonymous: num('RATE_LIMIT_PER_DAY_ANON', 100),
      /** Hard global cap on paid provider requests per UTC day. 0 = unlimited. */
      dailyBudgetRequests: num('DAILY_PROVIDER_BUDGET', 5000),
      providerTimeoutMs: num('PROVIDER_TIMEOUT_MS', 15000),
    },
    capture: { targetSeconds: 10, maxSeconds: 12, minSeconds: 4, sampleRate: 16000 },
    adminToken: process.env.ADMIN_TOKEN ?? '',
    staticDir: process.env.STATIC_DIR ?? '',
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
