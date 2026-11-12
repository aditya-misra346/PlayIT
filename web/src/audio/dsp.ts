import type { AudioMetrics } from '../types';

export const TARGET_SAMPLE_RATE = 16000;

export function toDb(linear: number): number {
  return linear > 1e-6 ? 20 * Math.log10(linear) : -120;
}

export function dbToNormalizedLevel(db: number): number {
  // Maps -60 dBFS .. 0 dBFS to 0.0 .. 1.0
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function removeDcOffset(samples: Float32Array): Float32Array {
  if (samples.length === 0) return samples;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i];
  const mean = sum / samples.length;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] - mean;
  return out;
}

export function analyzeMonoAudio(mono: Float32Array, sampleRate: number): AudioMetrics {
  let sumSq = 0;
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    sumSq += mono[i] * mono[i];
    if (a > peak) peak = a;
    if (a >= 0.985) clipped++;
  }
  const win = Math.max(1, Math.round(sampleRate * 0.05));
  let windows = 0;
  let silent = 0;
  for (let s = 0; s + win <= mono.length; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += mono[i] * mono[i];
    windows++;
    if (toDb(Math.sqrt(e / win)) < -55) silent++;
  }
  const rms = mono.length ? Math.sqrt(sumSq / mono.length) : 0;
  return {
    rmsDbfs: Math.round(toDb(rms) * 100) / 100,
    peak: Math.round(peak * 10000) / 10000,
    clippingRatio: Math.round((mono.length ? clipped / mono.length : 0) * 10000) / 10000,
    silenceRatio: Math.round((windows ? silent / windows : 1) * 10000) / 10000,
    durationMs: Math.round((mono.length / sampleRate) * 1000),
  };
}

/** Windowed-sinc (Blackman) anti-aliased resampler to 16,000 Hz. */
export function resampleMono(input: Float32Array, fromRate: number, toRate = TARGET_SAMPLE_RATE): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = toRate / fromRate;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio) * 0.95;
  const half = 20;
  const scale = Math.max(1, 1 / ratio);
  const taps = Math.ceil(half * scale);

  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const c0 = Math.floor(center);
    let acc = 0;
    let norm = 0;
    for (let k = c0 - taps + 1; k <= c0 + taps; k++) {
      if (k < 0 || k >= input.length) continue;
      const x = center - k;
      const t = x * cutoff;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
      const n = (x + taps) / (2 * taps);
      const wdw =
        n <= 0 || n >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
      const h = sinc * wdw;
      acc += input[k] * h;
      norm += h;
    }
    out[i] = norm ? acc / norm : 0;
  }
  return out;
}

export function encodeWav16(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < 4; i++) out[offset + i] = s.charCodeAt(i);
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

export function preprocessAndEncodeWav(
  rawMono: Float32Array,
  inputSampleRate: number,
): { wavBytes: Uint8Array; metrics: AudioMetrics } {
  const dcRemoved = removeDcOffset(rawMono);
  const metrics = analyzeMonoAudio(dcRemoved, inputSampleRate);
  const resampled = resampleMono(dcRemoved, inputSampleRate, TARGET_SAMPLE_RATE);

  // Gentle peak normalization to -1 dBFS (~0.891) only when peak < 0.5 and signal is not silent
  if (metrics.peak > 0.002 && metrics.peak < 0.5) {
    const gain = Math.min(8, 0.891 / metrics.peak);
    for (let i = 0; i < resampled.length; i++) {
      resampled[i] = Math.max(-1, Math.min(1, resampled[i] * gain));
    }
  }
  return {
    wavBytes: encodeWav16(resampled, TARGET_SAMPLE_RATE),
    metrics,
  };
}
