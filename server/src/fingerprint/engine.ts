import { resample } from '../audio/wav.js';
import { Radix2FFT } from './fft.js';

/**
 * Shazam-style Constellation-Map Acoustic Fingerprinting Engine (Wang 2003).
 *
 * Pipeline:
 * 1. Resample input to 16,000 Hz mono & apply first-order pre-emphasis (boosts high-frequency transients).
 * 2. Compute STFT magnitude spectrogram (1024-sample Hann window = 64 ms, hop 256 samples = 16 ms).
 * 3. Divide 250 Hz – 5,000 Hz into 6 logarithmic sub-bands and select candidate peaks per frame.
 * 4. Keep only 2D local maxima in a (time × frequency) neighborhood that exceed the local band adaptive envelope.
 * 5. Pair each anchor peak (t1, f1) with up to `FAN_OUT` target peaks (t2, f2) in a forward target zone
 *    (dt = t2 - t1 in [2, 63] frames = 32 ms .. 1.0 s) and pack (f1, f2, dt) into an unsigned 32-bit hash.
 * 6. During lookup, compute the time-offset histogram (t_catalog - t_query) for every matching hash.
 *    A true recording produces a sharp coherent peak at the exact playback offset inside the reference song.
 */

export const FP_SAMPLE_RATE = 16000;
export const FP_FFT_SIZE = 1024; // 64 ms @ 16 kHz (15.625 Hz / bin)
export const FP_HOP_SIZE = 256; // 16 ms per frame (62.5 frames / sec)
const FAN_OUT = 6;
const MIN_DT = 2; // 32 ms
const MAX_DT = 63; // ~1.0 s
const NEIGHBOR_TIME = 5; // +/- 5 frames (80 ms)
const NEIGHBOR_FREQ = 4; // +/- 4 bins (~62 Hz)

/** 6 logarithmic frequency bands covering bin 16 (~250 Hz) to bin 320 (~5000 Hz). */
const BANDS: ReadonlyArray<[number, number]> = [
  [16, 30],   // 250 - 468 Hz
  [30, 52],   // 468 - 812 Hz
  [52, 90],   // 812 - 1406 Hz
  [90, 148],  // 1406 - 2312 Hz
  [148, 224], // 2312 - 3500 Hz
  [224, 320], // 3500 - 5000 Hz
];

const fft = new Radix2FFT(FP_FFT_SIZE);

export interface Peak {
  t: number; // frame index (16 ms units)
  f: number; // frequency bin (16..319)
  mag: number;
}

export interface FingerprintHash {
  hash: number; // uint32 packed (f1: 9 bits | f2: 9 bits | dt: 6 bits)
  t: number;    // anchor frame index
}

export function extractConstellationPeaks(monoInput: Float32Array, sampleRate: number): Peak[] {
  const mono = sampleRate === FP_SAMPLE_RATE ? monoInput : resample(monoInput, sampleRate, FP_SAMPLE_RATE);
  if (mono.length < FP_FFT_SIZE) return [];

  // Normalize & pre-emphasize (y[n] = x[n] - 0.95 * x[n-1]) to make spectral peaks invariant to overall volume and speaker roll-off.
  let maxAbs = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs < 1e-4) return [];
  const sig = new Float32Array(mono.length);
  const scale = 1 / maxAbs;
  sig[0] = mono[0] * scale;
  for (let i = 1; i < mono.length; i++) {
    sig[i] = (mono[i] - 0.95 * mono[i - 1]) * scale;
  }

  const numFrames = Math.floor((sig.length - FP_FFT_SIZE) / FP_HOP_SIZE) + 1;
  const halfBins = FP_FFT_SIZE >>> 1;
  const spec = new Float32Array(numFrames * halfBins);
  const frameBuf = new Float32Array(halfBins);

  let globalSum = 0;
  let globalCount = 0;
  for (let t = 0; t < numFrames; t++) {
    fft.magnitudeSpectrumDb(sig, t * FP_HOP_SIZE, frameBuf);
    const rowOff = t * halfBins;
    for (let b = 16; b < 320; b++) {
      const v = frameBuf[b];
      spec[rowOff + b] = v;
      globalSum += v;
      globalCount++;
    }
  }
  const noiseFloorDb = globalCount ? globalSum / globalCount + 4.5 : -60;

  // Step 1: For each frame and each band, pick the strongest bin above noiseFloorDb.
  const candidates: Peak[] = [];
  for (let t = 0; t < numFrames; t++) {
    const rowOff = t * halfBins;
    for (const [bStart, bEnd] of BANDS) {
      let bestBin = -1;
      let bestVal = noiseFloorDb;
      for (let b = bStart; b < bEnd; b++) {
        const v = spec[rowOff + b];
        if (v > bestVal) {
          bestVal = v;
          bestBin = b;
        }
      }
      if (bestBin >= 0) {
        candidates.push({ t, f: bestBin, mag: bestVal });
      }
    }
  }

  // Step 2: 2D local maximum suppression in (t +/- NEIGHBOR_TIME, f +/- NEIGHBOR_FREQ).
  const peaks: Peak[] = [];
  for (const c of candidates) {
    let isMax = true;
    const tMin = Math.max(0, c.t - NEIGHBOR_TIME);
    const tMax = Math.min(numFrames - 1, c.t + NEIGHBOR_TIME);
    const fMin = Math.max(16, c.f - NEIGHBOR_FREQ);
    const fMax = Math.min(319, c.f + NEIGHBOR_FREQ);
    outer: for (let tt = tMin; tt <= tMax; tt++) {
      const rowOff = tt * halfBins;
      for (let ff = fMin; ff <= fMax; ff++) {
        if (tt === c.t && ff === c.f) continue;
        if (spec[rowOff + ff] > c.mag) {
          isMax = false;
          break outer;
        }
      }
    }
    if (isMax) peaks.push(c);
  }
  return peaks;
}

export function packHash(f1: number, f2: number, dt: number): number {
  return (((f1 & 0x1ff) << 15) | ((f2 & 0x1ff) << 6) | (dt & 0x3f)) >>> 0;
}

export function generateFingerprints(monoInput: Float32Array, sampleRate: number): FingerprintHash[] {
  const peaks = extractConstellationPeaks(monoInput, sampleRate);
  peaks.sort((a, b) => a.t - b.t || a.f - b.f);
  const hashes: FingerprintHash[] = [];

  for (let i = 0; i < peaks.length; i++) {
    const anchor = peaks[i];
    let paired = 0;
    for (let j = i + 1; j < peaks.length && paired < FAN_OUT; j++) {
      const target = peaks[j];
      const dt = target.t - anchor.t;
      if (dt < MIN_DT) continue;
      if (dt > MAX_DT) break;
      if (Math.abs(target.f - anchor.f) > 180) continue;
      hashes.push({
        hash: packHash(anchor.f, target.f, dt),
        t: anchor.t,
      });
      paired++;
    }
  }
  return hashes;
}

export interface CatalogTrackMeta {
  id: string;
  title: string;
  artists: string[];
  album: string | null;
  releaseDate: string | null;
  genres: string[];
  label: string | null;
  isrc: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  previewUrl?: string | null;
  links?: Array<{ service: string; url: string; label: string }>;
}

export interface CatalogMatch {
  track: CatalogTrackMeta;
  /** Number of time-aligned constellation hash pairs at the winning offset. */
  alignedHits: number;
  /** Second-best track's aligned hits (used for distinctiveness check). */
  runnerUpHits: number;
  /** Estimated playback offset in milliseconds into the catalog track. */
  offsetMs: number;
  /** Genuine confidence score (0..100) derived from time-coherent hash density & SNR over runner-up. */
  confidence: number;
}

/**
 * Inverted-index acoustic catalog supporting O(H) time-offset histogram matching.
 */
export class AcousticCatalogIndex {
  private readonly tracks = new Map<string, CatalogTrackMeta>();
  private readonly trackInternalIds: string[] = [];
  private readonly trackIdToIdx = new Map<string, number>();
  /** Map from 32-bit hash -> array of packed (trackIdx << 16 | anchorFrame) uint32 entries. */
  private readonly inverted = new Map<number, number[]>();

  get size(): number {
    return this.tracks.size;
  }

  listTracks(): CatalogTrackMeta[] {
    return [...this.tracks.values()];
  }

  addTrack(meta: CatalogTrackMeta, hashes: FingerprintHash[]): void {
    let idx = this.trackIdToIdx.get(meta.id);
    if (idx === undefined) {
      idx = this.trackInternalIds.length;
      this.trackInternalIds.push(meta.id);
      this.trackIdToIdx.set(meta.id, idx);
    }
    this.tracks.set(meta.id, meta);

    for (const { hash, t } of hashes) {
      const clampedT = Math.min(0xffff, Math.max(0, t));
      const entry = ((idx & 0xffff) << 16) | clampedT;
      let list = this.inverted.get(hash);
      if (!list) {
        list = [];
        this.inverted.set(hash, list);
      }
      list.push(entry);
    }
  }

  /**
   * Match a query sample against the catalog.
   * Returns null if no track achieves >= `minAlignedHits` coherent offset votes.
   */
  match(monoInput: Float32Array, sampleRate: number, minAlignedHits = 20): CatalogMatch | null {
    const queryHashes = generateFingerprints(monoInput, sampleRate);
    if (queryHashes.length < 8 || this.tracks.size === 0) return null;

    // Group query frame indices by hash to avoid duplicate lookups.
    // For each track, accumulate a histogram of coarse offset bins (quantized to 2 frames = 32 ms to tolerate minor clock drift).
    const offsetHistByTrack = new Map<number, Map<number, number>>();

    for (const q of queryHashes) {
      const postings = this.inverted.get(q.hash);
      if (!postings) continue;
      for (let i = 0; i < postings.length; i++) {
        const packed = postings[i];
        const trackIdx = (packed >>> 16) & 0xffff;
        const catT = packed & 0xffff;
        const deltaBin = Math.round((catT - q.t) / 2); // 32 ms offset tolerance bin
        let hist = offsetHistByTrack.get(trackIdx);
        if (!hist) {
          hist = new Map<number, number>();
          offsetHistByTrack.set(trackIdx, hist);
        }
        hist.set(deltaBin, (hist.get(deltaBin) ?? 0) + 1);
      }
    }

    let bestTrackIdx = -1;
    let bestHits = 0;
    let bestDeltaBin = 0;
    let runnerUpHits = 0;

    for (const [trackIdx, hist] of offsetHistByTrack.entries()) {
      let trackPeak = 0;
      let trackBestBin = 0;
      for (const [bin, count] of hist.entries()) {
        // Sum adjacent bin (bin, bin+1) to avoid boundary splitting across 32 ms bins.
        const combined = count + (hist.get(bin + 1) ?? 0);
        if (combined > trackPeak) {
          trackPeak = combined;
          trackBestBin = bin;
        }
      }
      if (trackPeak > bestHits) {
        runnerUpHits = bestHits;
        bestHits = trackPeak;
        bestTrackIdx = trackIdx;
        bestDeltaBin = trackBestBin;
      } else if (trackPeak > runnerUpHits) {
        runnerUpHits = trackPeak;
      }
    }

    if (bestTrackIdx < 0 || bestHits < minAlignedHits) return null;
    // Also require distinctiveness over the runner-up track so noise cannot ambiguously trigger.
    if (runnerUpHits > 0 && bestHits < runnerUpHits * 1.6 && bestHits < minAlignedHits * 2) {
      return null;
    }

    const trackId = this.trackInternalIds[bestTrackIdx];
    const track = this.tracks.get(trackId)!;
    const frameDurationMs = (FP_HOP_SIZE / FP_SAMPLE_RATE) * 1000; // 16 ms
    const offsetMs = Math.max(0, Math.round(bestDeltaBin * 2 * frameDurationMs));

    // Confidence derived from aligned hit count and ratio over threshold (capped 70..100 like ACRCloud).
    const hitFraction = Math.min(1, bestHits / Math.max(60, queryHashes.length * 0.28));
    const ratioBoost = runnerUpHits > 0 ? Math.min(1, (bestHits / runnerUpHits - 1) / 4) : 1;
    const confidence = Math.max(70, Math.min(100, Math.round(68 + 24 * hitFraction + 8 * ratioBoost)));

    return {
      track,
      alignedHits: bestHits,
      runnerUpHits,
      offsetMs,
      confidence,
    };
  }

  toJSON(): { tracks: Array<{ meta: CatalogTrackMeta; hashes: Array<[number, number]> }> } {
    const perTrack = new Map<number, Array<[number, number]>>();
    for (const [hash, list] of this.inverted.entries()) {
      for (const packed of list) {
        const idx = (packed >>> 16) & 0xffff;
        const t = packed & 0xffff;
        let arr = perTrack.get(idx);
        if (!arr) {
          arr = [];
          perTrack.set(idx, arr);
        }
        arr.push([hash, t]);
      }
    }
    const out: Array<{ meta: CatalogTrackMeta; hashes: Array<[number, number]> }> = [];
    for (let idx = 0; idx < this.trackInternalIds.length; idx++) {
      const id = this.trackInternalIds[idx];
      const meta = this.tracks.get(id);
      if (meta) {
        out.push({ meta, hashes: perTrack.get(idx) ?? [] });
      }
    }
    return { tracks: out };
  }

  static fromJSON(data: { tracks?: Array<{ meta: CatalogTrackMeta; hashes: Array<[number, number]> }> }): AcousticCatalogIndex {
    const idx = new AcousticCatalogIndex();
    for (const item of data.tracks ?? []) {
      idx.addTrack(
        item.meta,
        item.hashes.map(([hash, t]) => ({ hash, t })),
      );
    }
    return idx;
  }
}
