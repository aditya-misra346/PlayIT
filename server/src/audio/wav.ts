import { ApiError } from '../errors.js';

export interface DecodedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: 'pcm' | 'float';
  /** Mono, float32 in [-1, 1]. */
  mono: Float32Array;
  durationMs: number;
}

/** Parse a RIFF/WAVE buffer (PCM 8/16/24/32-bit int or 32-bit float, any channel count) into mono float32. */
export function decodeWav(buf: Uint8Array): DecodedWav {
  if (buf.byteLength < 44) throw new ApiError('UNSUPPORTED_FORMAT', 'Audio must be a WAV file.');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new ApiError('UNSUPPORTED_FORMAT', 'Audio must be a RIFF/WAVE file.');

  let off = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1;
  let dataLen = 0;
  while (off + 8 <= buf.byteLength) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === 'fmt ') {
      let audioFormat = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      const sampleRate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      if (audioFormat === 0xfffe && size >= 40) audioFormat = dv.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
      fmt = { audioFormat, channels, sampleRate, bits };
    } else if (id === 'data') {
      dataOff = body;
      dataLen = Math.min(size, buf.byteLength - body); // tolerate streaming writers that leave size=0xFFFFFFFF
      break;
    }
    off = body + size + (size & 1);
  }
  if (!fmt || dataOff < 0) throw new ApiError('UNSUPPORTED_FORMAT', 'WAV file is missing fmt or data chunk.');
  const { audioFormat, channels, sampleRate, bits } = fmt;
  if (channels < 1 || channels > 8 || sampleRate < 8000 || sampleRate > 192000) {
    throw new ApiError('UNSUPPORTED_FORMAT', 'Unsupported WAV channel count or sample rate.');
  }
  const isFloat = audioFormat === 3;
  if (!(audioFormat === 1 && [8, 16, 24, 32].includes(bits)) && !(isFloat && bits === 32)) {
    throw new ApiError('UNSUPPORTED_FORMAT', 'WAV must be PCM (8/16/24/32-bit) or 32-bit float.');
  }
  const bytesPer = bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bytesPer;
      let s: number;
      if (isFloat) s = dv.getFloat32(p, true);
      else if (bits === 16) s = dv.getInt16(p, true) / 32768;
      else if (bits === 24) {
        let v = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16);
        if (v & 0x800000) v |= ~0xffffff;
        s = v / 8388608;
      } else if (bits === 32) s = dv.getInt32(p, true) / 2147483648;
      else s = (buf[p] - 128) / 128;
      acc += s;
    }
    mono[i] = acc / channels;
  }
  return { sampleRate, channels, bitsPerSample: bits, format: isFloat ? 'float' : 'pcm', mono, durationMs: (frames / sampleRate) * 1000 };
}

/** Encode mono float32 to 16-bit PCM WAV. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return out;
}

export interface AudioMetrics {
  rmsDbfs: number;
  peak: number;
  clippingRatio: number;
  silenceRatio: number;
}

/** Quality metrics defined in docs/CONTRACT.md. */
export function analyze(mono: Float32Array, sampleRate: number): AudioMetrics {
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
    rmsDbfs: round(toDb(rms)),
    peak: round(peak, 4),
    clippingRatio: round(mono.length ? clipped / mono.length : 0, 4),
    silenceRatio: round(windows ? silent / windows : 1, 4),
  };
}

export function toDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -120;
}
function round(x: number, d = 2) {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

/** Windowed-sinc (Blackman) resampler with anti-aliasing low-pass. Adequate quality for fingerprinting. */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice();
  const ratio = to / from;
  const outLen = Math.floor(input.length * ratio);
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio) * 0.95; // normalised to input Nyquist
  const half = 24; // taps each side (in input samples, scaled below)
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
      const wdw = n <= 0 || n >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * n) + 0.08 * Math.cos(4 * Math.PI * n);
      const h = sinc * wdw;
      acc += input[k] * h;
      norm += h;
    }
    out[i] = norm ? acc / norm : 0;
  }
  return out;
}
