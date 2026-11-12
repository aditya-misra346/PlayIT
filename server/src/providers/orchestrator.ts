import { ApiError, isProviderFailure } from '../errors.js';
import { analyze, decodeWav, encodeWav16, resample } from '../audio/wav.js';
import { generateFingerprints } from '../fingerprint/engine.js';
import type { ProviderId, ProviderOutcome, RecognitionContext, RecognitionProvider, TrackMatch } from '../types.js';
import { enrichTrackMetadata } from './enrich.js';

export interface OrchestratorOptions {
  providers: Map<ProviderId, RecognitionProvider>;
  providerOrder: ProviderId[];
  fallbackOnNoMatch: boolean;
  minSeconds: number;
  maxSeconds: number;
  maxUploadBytes: number;
  providerTimeoutMs: number;
  dailyBudgetRequests: number;
  onProviderCall?: (providerId: ProviderId, status: 'match' | 'no_match' | 'error', costUsd: number, latencyMs: number) => void;
  getTodayPaidRequests?: () => number;
}

export interface RecognitionResponse {
  status: 'match' | 'no_match';
  requestId: string;
  latencyMs: number;
  provider: { id: ProviderId; name: string };
  result?: TrackMatch;
  audioMetrics: {
    rmsDbfs: number;
    peak: number;
    clippingRatio: number;
    silenceRatio: number;
    durationMs: number;
    sampleRate?: number;
    channels?: number;
    byteLength?: number;
    fingerprintHashCount?: number;
  };
  cached?: boolean;
}

export interface AudioDiagnosticReport {
  valid: boolean;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  durationMs: number;
  byteLength: number;
  rmsDbfs: number;
  peak: number;
  clippingRatio: number;
  silenceRatio: number;
  fingerprintHashCount: number;
  checks: {
    signalDetected: boolean;
    levelSufficient: boolean;
    durationSufficient: boolean;
    notClippingSeverely: boolean;
    encodedValid: boolean;
    fingerprintReady: boolean;
  };
}

interface CacheEntry {
  expiresAt: number;
  provider: { id: ProviderId; name: string };
  result: TrackMatch;
}

/**
 * Multi-provider recognition orchestrator.
 * - Validates and normalizes incoming WAV audio (16 kHz mono PCM 16-bit, DC removal, gentle peak normalization).
 * - Enforces silence/clipping/duration checks before spending commercial provider quota.
 * - Deduplicates identical acoustic fingerprint queries within a short TTL (60s) to prevent accidental double-taps from billing twice.
 * - Routes to the primary configured provider, falling back to secondary providers on provider failure
 *   (or on no_match when `fallbackOnNoMatch` is enabled or when falling back from commercial to local reference catalog in dev).
 */
export class RecognitionOrchestrator {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly opts: OrchestratorOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  listProviderStatus() {
    const configured = this.getOrderedConfiguredProviders();
    return this.opts.providerOrder
      .map((id) => this.opts.providers.get(id))
      .filter((p): p is RecognitionProvider => Boolean(p))
      .map((p) => {
        const idx = configured.findIndex((c) => c.id === p.id);
        return {
          id: p.id,
          name: p.name,
          configured: p.isConfigured(),
          role: idx === 0 ? 'primary' : idx > 0 ? 'fallback' : 'disabled',
          processing: p.id === 'local' ? 'server-local-fingerprint' : 'server-cloud-api',
          confidence: p.suppliesConfidence,
        };
      });
  }

  getOrderedConfiguredProviders(requestedProvider?: ProviderId): RecognitionProvider[] {
    if (requestedProvider) {
      const p = this.opts.providers.get(requestedProvider);
      if (!p || !p.isConfigured()) {
        throw new ApiError('NOT_CONFIGURED', `Requested recognition provider "${requestedProvider}" is not configured.`);
      }
      return [p];
    }
    return this.opts.providerOrder
      .map((id) => this.opts.providers.get(id))
      .filter((p): p is RecognitionProvider => Boolean(p && p.isConfigured()));
  }

  inspectAudio(rawWav: Uint8Array): AudioDiagnosticReport {
    const decoded = decodeWav(rawWav);
    let mean = 0;
    for (let i = 0; i < decoded.mono.length; i++) mean += decoded.mono[i];
    mean /= decoded.mono.length || 1;
    const dcRemoved = new Float32Array(decoded.mono.length);
    for (let i = 0; i < decoded.mono.length; i++) dcRemoved[i] = decoded.mono[i] - mean;

    const metrics = analyze(dcRemoved, decoded.sampleRate);
    const resampled = decoded.sampleRate === 16000 ? dcRemoved : resample(dcRemoved, decoded.sampleRate, 16000);
    const hashes = generateFingerprints(resampled, 16000);

    const signalDetected = metrics.peak > 0.002 && metrics.silenceRatio < 0.95;
    const levelSufficient = metrics.rmsDbfs >= -50 && metrics.silenceRatio <= 0.85;
    const durationSufficient = decoded.durationMs / 1000 >= this.opts.minSeconds;
    const notClippingSeverely = metrics.clippingRatio < 0.15;
    const encodedValid = decoded.sampleRate >= 8000 && decoded.channels >= 1;
    const fingerprintReady = hashes.length >= 12;

    return {
      valid: signalDetected && levelSufficient && durationSufficient && encodedValid && fingerprintReady,
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      bitsPerSample: decoded.bitsPerSample,
      durationMs: Math.round(decoded.durationMs),
      byteLength: rawWav.byteLength,
      rmsDbfs: metrics.rmsDbfs,
      peak: metrics.peak,
      clippingRatio: metrics.clippingRatio,
      silenceRatio: metrics.silenceRatio,
      fingerprintHashCount: hashes.length,
      checks: {
        signalDetected,
        levelSufficient,
        durationSufficient,
        notClippingSeverely,
        encodedValid,
        fingerprintReady,
      },
    };
  }

  async recognize(
    rawWav: Uint8Array,
    ctx: RecognitionContext,
    requestedProvider?: ProviderId,
  ): Promise<RecognitionResponse> {
    const startMs = Date.now();
    if (rawWav.byteLength > this.opts.maxUploadBytes) {
      throw new ApiError('PAYLOAD_TOO_LARGE', `Audio sample exceeds maximum size of ${this.opts.maxUploadBytes} bytes.`);
    }

    const decoded = decodeWav(rawWav);
    const durationSec = decoded.durationMs / 1000;
    if (durationSec < this.opts.minSeconds) {
      throw new ApiError(
        'AUDIO_TOO_SHORT',
        `Audio sample is too short (${durationSec.toFixed(1)}s). Capture at least ${this.opts.minSeconds} seconds of music.`,
      );
    }

    // Truncate if longer than maxSeconds so we never upload oversized recordings
    const maxFrames = Math.floor(this.opts.maxSeconds * decoded.sampleRate);
    const monoRaw = decoded.mono.length > maxFrames ? decoded.mono.subarray(0, maxFrames) : decoded.mono;

    // Step 1: DC offset removal
    let mean = 0;
    for (let i = 0; i < monoRaw.length; i++) mean += monoRaw[i];
    mean /= monoRaw.length || 1;
    const dcRemoved = new Float32Array(monoRaw.length);
    for (let i = 0; i < monoRaw.length; i++) dcRemoved[i] = monoRaw[i] - mean;

    // Step 2: Quality gate (RMS & silence ratio)
    const metrics = analyze(dcRemoved, decoded.sampleRate);
    if (metrics.rmsDbfs < -50 || metrics.silenceRatio > 0.85) {
      throw new ApiError(
        'AUDIO_SILENT',
        'Only silence or very quiet background audio was detected. Move closer to the speaker or turn up the volume.',
      );
    }

    // Step 3: Resample to 16,000 Hz mono & apply gentle peak normalization to -1 dBFS (~0.891) if peak < 0.5
    const resampled = decoded.sampleRate === 16000 ? dcRemoved : resample(dcRemoved, decoded.sampleRate, 16000);
    if (metrics.peak > 0.003 && metrics.peak < 0.5) {
      const gain = Math.min(8, 0.891 / metrics.peak);
      for (let i = 0; i < resampled.length; i++) {
        resampled[i] = Math.max(-1, Math.min(1, resampled[i] * gain));
      }
    }
    const normalizedWav = encodeWav16(resampled, 16000);

    // Step 4: Compute short-lived acoustic digest key from top constellation hashes to avoid duplicate billing on double-taps
    const fpHashes = generateFingerprints(resampled, 16000);
    const cacheKey =
      fpHashes.length >= 12
        ? `${requestedProvider ?? 'auto'}:${fpHashes
            .slice(0, 16)
            .map((h) => h.hash.toString(36))
            .join('.')}`
        : null;
    const enrichedMetrics = {
      ...metrics,
      durationMs: Math.round(decoded.durationMs),
      sampleRate: decoded.sampleRate,
      channels: decoded.channels,
      byteLength: rawWav.byteLength,
      fingerprintHashCount: fpHashes.length,
    };

    if (cacheKey) {
      const hit = this.cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return {
          status: 'match',
          requestId: ctx.requestId,
          latencyMs: Date.now() - startMs,
          provider: hit.provider,
          result: {
            ...hit.result,
            match: {
              ...hit.result.match,
              recognizedAt: new Date().toISOString(),
              source: ctx.source,
              platform: ctx.platform,
            },
          },
          audioMetrics: enrichedMetrics,
          cached: true,
        };
      }
    }

    const chain = this.getOrderedConfiguredProviders(requestedProvider);
    if (chain.length === 0) {
      throw new ApiError(
        'NOT_CONFIGURED',
        'No music recognition provider is configured. Set AUDD_API_TOKEN or ACRCLOUD_* credentials, or enable the local acoustic catalog.',
      );
    }

    let lastError: unknown = null;
    let lastProvider = chain[0];
    let cleanNoMatchProvider: RecognitionProvider | null = null;

    for (let idx = 0; idx < chain.length; idx++) {
      const provider = chain[idx];
      lastProvider = provider;

      // Enforce daily paid provider budget
      if (provider.costPerRequestUsd > 0 && this.opts.dailyBudgetRequests > 0 && this.opts.getTodayPaidRequests) {
        if (this.opts.getTodayPaidRequests() >= this.opts.dailyBudgetRequests) {
          lastError = new ApiError('BUDGET_EXCEEDED', 'Daily recognition budget has been reached.');
          continue;
        }
      }

      const callStart = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.opts.providerTimeoutMs);

      try {
        const outcome: ProviderOutcome = await provider.recognize(normalizedWav, ctx, ctrl.signal);
        clearTimeout(timer);
        const callLatency = Date.now() - callStart;
        this.opts.onProviderCall?.(provider.id, outcome.status, provider.costPerRequestUsd, callLatency);

        if (outcome.status === 'match') {
          const enriched = await enrichTrackMetadata(outcome.result, this.fetchImpl);
          if (cacheKey) {
            this.cache.set(cacheKey, {
              expiresAt: Date.now() + 60_000,
              provider: { id: provider.id, name: provider.name },
              result: enriched,
            });
          }
          return {
            status: 'match',
            requestId: ctx.requestId,
            latencyMs: Date.now() - startMs,
            provider: { id: provider.id, name: provider.name },
            result: enriched,
            audioMetrics: enrichedMetrics,
          };
        }

        cleanNoMatchProvider = provider;

        // If no_match: only try next provider if `fallbackOnNoMatch` is true OR the next provider is free (`costPerRequestUsd === 0`)
        const nextProvider = chain[idx + 1];
        if (nextProvider && (this.opts.fallbackOnNoMatch || nextProvider.costPerRequestUsd === 0)) {
          continue;
        }
        return {
          status: 'no_match',
          requestId: ctx.requestId,
          latencyMs: Date.now() - startMs,
          provider: { id: provider.id, name: provider.name },
          audioMetrics: enrichedMetrics,
        };
      } catch (err) {
        clearTimeout(timer);
        const callLatency = Date.now() - callStart;
        this.opts.onProviderCall?.(provider.id, 'error', 0, callLatency);
        lastError = err;
        if (isProviderFailure(err) && idx + 1 < chain.length) {
          continue;
        }
        if (isProviderFailure(err) && cleanNoMatchProvider && !requestedProvider) {
          return {
            status: 'no_match',
            requestId: ctx.requestId,
            latencyMs: Date.now() - startMs,
            provider: { id: cleanNoMatchProvider.id, name: cleanNoMatchProvider.name },
            audioMetrics: enrichedMetrics,
          };
        }
        throw err;
      }
    }

    if (lastError instanceof ApiError && !cleanNoMatchProvider) throw lastError;
    const finalProvider = cleanNoMatchProvider ?? lastProvider;
    return {
      status: 'no_match',
      requestId: ctx.requestId,
      latencyMs: Date.now() - startMs,
      provider: { id: finalProvider.id, name: finalProvider.name },
      audioMetrics: enrichedMetrics,
    };
  }
}
