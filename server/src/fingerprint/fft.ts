/**
 * In-place Radix-2 Cooley-Tukey FFT for real/complex signals.
 * Used by the spectrogram stage of the constellation-peak acoustic fingerprinter.
 */
export class Radix2FFT {
  readonly size: number;
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  readonly hann: Float32Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0 || size < 16) {
      throw new Error(`FFT size must be a power of 2 >= 16, got ${size}`);
    }
    this.size = size;
    const bits = Math.round(Math.log2(size));
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>>= 1;
      }
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let k = 0; k < size / 2; k++) {
      const ang = (-2 * Math.PI * k) / size;
      this.cos[k] = Math.cos(ang);
      this.sin[k] = Math.sin(ang);
    }
    this.hann = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
  }

  /**
   * Compute magnitude spectrum (in dB) for the first `size / 2` bins of `frame` (starting at `offset`).
   */
  magnitudeSpectrumDb(signal: Float32Array, offset: number, outMagDb: Float32Array): void {
    const n = this.size;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const idx = this.rev[i];
      re[i] = (signal[offset + idx] ?? 0) * this.hann[idx];
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        let k = 0;
        for (let j = 0; j < half; j++) {
          const wr = this.cos[k];
          const wi = this.sin[k];
          const tr = wr * re[i + j + half] - wi * im[i + j + half];
          const ti = wr * im[i + j + half] + wi * re[i + j + half];
          re[i + j + half] = re[i + j] - tr;
          im[i + j + half] = im[i + j] - ti;
          re[i + j] += tr;
          im[i + j] += ti;
          k += step;
        }
      }
    }
    const halfN = n >>> 1;
    for (let b = 0; b < halfN; b++) {
      const magSq = re[b] * re[b] + im[b] * im[b];
      outMagDb[b] = 10 * Math.log10(magSq + 1e-12);
    }
  }
}
