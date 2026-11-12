import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeWav } from '../audio/wav.js';
import {
  AcousticCatalogIndex,
  generateFingerprints,
  type CatalogTrackMeta,
} from '../fingerprint/engine.js';
import { getDefaultReferenceCatalog } from '../fingerprint/referenceCatalog.js';
import type { LinkService, ProviderOutcome, RecognitionContext, RecognitionProvider } from '../types.js';
import { buildTrack, link, safeMediaUrl } from './normalize.js';

/**
 * Local Acoustic Fingerprinting Provider (`id: "local"`).
 * Uses our Constellation-Peak + Time-Coherent Offset Histogram engine (Wang 2003).
 * Preloaded with the Auralis Reference Catalog + any user-ingested WAV tracks stored in `catalogPath`.
 */
export class LocalCatalogProvider implements RecognitionProvider {
  readonly id = 'local' as const;
  readonly name = 'PlayIT Acoustic Engine (Reference & Custom Catalog)';
  readonly suppliesConfidence = true;
  readonly costPerRequestUsd = 0;
  private index: AcousticCatalogIndex;

  constructor(private readonly opts: { enabled: boolean; catalogPath: string; minScore: number }) {
    this.index = getDefaultReferenceCatalog();
    this.loadCustomCatalog();
  }

  isConfigured(): boolean {
    return this.opts.enabled && this.index.size > 0;
  }

  get catalogSize(): number {
    return this.index.size;
  }

  listCatalogTracks(): CatalogTrackMeta[] {
    return this.index.listTracks();
  }

  ingestTrack(meta: CatalogTrackMeta, mono: Float32Array, sampleRate: number, persist = true): { hashesAdded: number } {
    const hashes = generateFingerprints(mono, sampleRate);
    this.index.addTrack(meta, hashes);
    if (persist && this.opts.catalogPath) {
      try {
        mkdirSync(dirname(this.opts.catalogPath), { recursive: true });
        writeFileSync(this.opts.catalogPath, JSON.stringify(this.index.toJSON()), 'utf8');
      } catch {
        // Ignore persistence errors in read-only environments
      }
    }
    return { hashesAdded: hashes.length };
  }

  private loadCustomCatalog(): void {
    if (!this.opts.catalogPath || !existsSync(this.opts.catalogPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.opts.catalogPath, 'utf8'));
      const loaded = AcousticCatalogIndex.fromJSON(raw);
      for (const item of loaded.toJSON().tracks) {
        this.index.addTrack(
          item.meta,
          item.hashes.map(([hash, t]) => ({ hash, t })),
        );
      }
    } catch {
      // Ignore corrupt custom catalog file
    }
  }

  async recognize(wav: Uint8Array, ctx: RecognitionContext, _signal: AbortSignal): Promise<ProviderOutcome> {
    const decoded = decodeWav(wav);
    const match = this.index.match(decoded.mono, decoded.sampleRate, this.opts.minScore);
    if (!match) {
      return { status: 'no_match' };
    }
    const m = match.track;
    const artUrl = safeMediaUrl(m.artworkUrl);
    const result = buildTrack(
      'local',
      {
        title: m.title,
        artists: m.artists,
        album: m.album,
        releaseDate: m.releaseDate,
        genres: m.genres,
        label: m.label,
        isrc: m.isrc,
        durationMs: m.durationMs,
        artwork: artUrl ? { url: artUrl, thumbUrl: artUrl, width: 1000, height: 1000 } : null,
        previewUrl: m.previewUrl ?? null,
        providerTrackId: m.id,
        offsetMs: match.offsetMs,
        confidence: { value: match.confidence, scale: 100 },
        links: (m.links ?? []).map((l) => link(l.service as LinkService, l.url)),
      },
      ctx,
    );
    return {
      status: 'match',
      result,
      raw: { alignedHits: match.alignedHits, runnerUpHits: match.runnerUpHits },
    };
  }
}
