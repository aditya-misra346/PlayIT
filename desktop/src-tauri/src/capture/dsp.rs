use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;

pub const TARGET_SAMPLE_RATE: u32 = 16_000;
pub const CLIPPING_THRESHOLD: f32 = 0.985;
pub const SILENCE_WINDOW_MS: u32 = 50;
pub const SILENCE_THRESHOLD_DBFS: f64 = -55.0;
pub const TOO_QUIET_RMS_DBFS: f64 = -50.0;
pub const TOO_QUIET_SILENCE_RATIO: f64 = 0.85;
pub const TARGET_NORMALIZE_PEAK: f32 = 0.891_250_94; // -1.0 dBFS = 10^(-1/20)

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QualityMetrics {
    pub rms_dbfs: f64,
    pub peak: f64,
    pub clipping_ratio: f64,
    pub silence_ratio: f64,
}

impl Default for QualityMetrics {
    fn default() -> Self {
        Self {
            rms_dbfs: -100.0,
            peak: 0.0,
            clipping_ratio: 0.0,
            silence_ratio: 1.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProcessedAudio {
    pub wav_bytes: Vec<u8>,
    pub wav_base64: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub metrics: QualityMetrics,
}

/// Downmix interleaved multi-channel audio frames to mono by averaging channels.
pub fn downmix_to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels == 0 || interleaved.is_empty() {
        return Vec::new();
    }
    if channels == 1 {
        return interleaved.to_vec();
    }
    let frames = interleaved.len() / channels;
    let inv = 1.0 / (channels as f32);
    let mut mono = Vec::with_capacity(frames);
    for frame in interleaved.chunks_exact(channels) {
        let sum: f32 = frame.iter().copied().sum();
        mono.push(sum * inv);
    }
    mono
}

/// Remove DC offset in-place by subtracting the mean sample value.
pub fn remove_dc_offset(samples: &mut [f32]) {
    if samples.is_empty() {
        return;
    }
    let sum: f64 = samples.iter().map(|&x| x as f64).sum();
    let mean = (sum / (samples.len() as f64)) as f32;
    if mean.abs() > 1e-9 {
        for s in samples.iter_mut() {
            *s -= mean;
        }
    }
}

/// Compute live level meter reading `{ rms: 0..1, peak: 0..1 }` from recent ~50ms mono samples.
/// Maps RMS from -60..0 dBFS linearly to 0..1 per CONTRACT.md.
pub fn compute_live_level(window: &[f32]) -> (f32, f32) {
    if window.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum_sq = 0.0_f64;
    let mut peak = 0.0_f32;
    for &s in window {
        let abs = s.abs();
        if abs > peak {
            peak = abs;
        }
        let v = s as f64;
        sum_sq += v * v;
    }
    let rms_lin = (sum_sq / (window.len() as f64)).sqrt();
    let rms_dbfs = if rms_lin <= 1e-6 {
        -60.0
    } else {
        (20.0 * rms_lin.log10()).clamp(-60.0, 0.0)
    };
    let rms_norm = (((rms_dbfs + 60.0) / 60.0) as f32).clamp(0.0, 1.0);
    let peak_norm = peak.clamp(0.0, 1.0);
    (rms_norm, peak_norm)
}

/// Compute pre-upload quality metrics on the mono signal:
/// - `rmsDbfs`: overall RMS in dBFS
/// - `peak`: maximum absolute sample amplitude
/// - `clippingRatio`: fraction of samples with |x| >= 0.985
/// - `silenceRatio`: fraction of 50 ms windows with RMS < -55 dBFS
pub fn compute_quality_metrics(mono: &[f32], sample_rate: u32) -> QualityMetrics {
    if mono.is_empty() || sample_rate == 0 {
        return QualityMetrics::default();
    }

    let mut sum_sq = 0.0_f64;
    let mut peak = 0.0_f64;
    let mut clipped_count = 0_usize;

    for &s in mono {
        let abs = (s as f64).abs();
        if abs > peak {
            peak = abs;
        }
        if s.abs() >= CLIPPING_THRESHOLD {
            clipped_count += 1;
        }
        let v = s as f64;
        sum_sq += v * v;
    }

    let n = mono.len() as f64;
    let rms_lin = (sum_sq / n).sqrt();
    let rms_dbfs = if rms_lin <= 1e-5 {
        -100.0
    } else {
        (20.0 * rms_lin.log10()).max(-100.0)
    };
    let clipping_ratio = (clipped_count as f64) / n;

    let window_samples = ((sample_rate as usize) * (SILENCE_WINDOW_MS as usize) / 1000).max(1);
    let mut total_windows = 0_usize;
    let mut silent_windows = 0_usize;

    for chunk in mono.chunks(window_samples) {
        if chunk.is_empty() {
            continue;
        }
        total_windows += 1;
        let win_sum_sq: f64 = chunk.iter().map(|&x| (x as f64) * (x as f64)).sum();
        let win_rms = (win_sum_sq / (chunk.len() as f64)).sqrt();
        let win_dbfs = if win_rms <= 1e-6 {
            -100.0
        } else {
            20.0 * win_rms.log10()
        };
        if win_dbfs < SILENCE_THRESHOLD_DBFS {
            silent_windows += 1;
        }
    }

    let silence_ratio = if total_windows == 0 {
        1.0
    } else {
        (silent_windows as f64) / (total_windows as f64)
    };

    QualityMetrics {
        rms_dbfs,
        peak,
        clipping_ratio,
        silence_ratio,
    }
}

/// Anti-aliased windowed-sinc (Blackman window) resampler to convert from `src_rate` to `dst_rate`.
pub fn resample_blackman_sinc(input: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if input.is_empty() || src_rate == 0 || dst_rate == 0 {
        return Vec::new();
    }
    if src_rate == dst_rate {
        return input.to_vec();
    }

    let ratio = (dst_rate as f64) / (src_rate as f64);
    let out_len = ((input.len() as f64) * ratio).round() as usize;
    if out_len == 0 {
        return Vec::new();
    }

    // Normalized cutoff frequency relative to src_rate (0.5 = Nyquist of src_rate).
    let cutoff = if ratio < 1.0 {
        0.45 * ratio
    } else {
        0.45
    };
    let half_width: isize = if ratio < 1.0 {
        ((16.0 / ratio).ceil() as isize).clamp(16, 128)
    } else {
        16
    };
    let half_width_f = half_width as f64;
    let in_len = input.len() as isize;

    let mut output = Vec::with_capacity(out_len);
    for m in 0..out_len {
        let center = (m as f64) / ratio;
        let center_idx = center.floor() as isize;
        let start_k = center_idx - half_width;
        let end_k = center_idx + half_width;

        let mut sample_sum = 0.0_f64;
        let mut weight_sum = 0.0_f64;

        for k in start_k..=end_k {
            let x = center - (k as f64);
            let sinc_arg = 2.0 * cutoff * x;
            let sinc = if sinc_arg.abs() < 1e-9 {
                1.0
            } else {
                let pix = PI * sinc_arg;
                pix.sin() / pix
            };

            let u = 0.5 * ((x / half_width_f).clamp(-1.0, 1.0) + 1.0);
            let blackman = 0.42 - 0.5 * (2.0 * PI * u).cos() + 0.08 * (4.0 * PI * u).cos();
            let weight = 2.0 * cutoff * sinc * blackman;

            weight_sum += weight;
            if k >= 0 && k < in_len {
                sample_sum += (input[k as usize] as f64) * weight;
            }
        }

        let val = if weight_sum.abs() > 1e-9 {
            (sample_sum / weight_sum) as f32
        } else {
            0.0
        };
        output.push(val.clamp(-1.0, 1.0));
    }

    output
}

/// Gentle peak normalization to -1 dBFS (~0.891) ONLY when `0 < peak < 0.5` and signal is not silent.
pub fn normalize_gentle_peak(samples: &mut [f32], metrics: &QualityMetrics) -> bool {
    let is_silent =
        metrics.rms_dbfs < TOO_QUIET_RMS_DBFS || metrics.silence_ratio > TOO_QUIET_SILENCE_RATIO;
    if is_silent || samples.is_empty() {
        return false;
    }

    let current_peak = samples
        .iter()
        .fold(0.0_f32, |acc, &x| acc.max(x.abs()));

    if current_peak > 0.0 && current_peak < 0.5 {
        let gain = TARGET_NORMALIZE_PEAK / current_peak;
        for s in samples.iter_mut() {
            *s = (*s * gain).clamp(-1.0, 1.0);
        }
        true
    } else {
        false
    }
}

/// Encode mono f32 samples (-1.0..1.0) into standard 44-byte header 16-bit PCM little-endian WAV.
pub fn encode_wav_pcm16_mono(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let num_channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let block_align: u16 = num_channels * (bits_per_sample / 8);
    let byte_rate: u32 = sample_rate * (block_align as u32);
    let data_bytes: u32 = (samples.len() * 2) as u32;
    let riff_chunk_size: u32 = 36 + data_bytes;

    let mut buf = Vec::with_capacity(44 + (data_bytes as usize));
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&riff_chunk_size.to_le_bytes());
    buf.extend_from_slice(b"WAVE");

    // fmt subchunk
    buf.extend_from_slice(b"fmt ");
    buf.extend_from_slice(&16_u32.to_le_bytes()); // Subchunk1Size for PCM
    buf.extend_from_slice(&1_u16.to_le_bytes()); // AudioFormat = 1 (PCM)
    buf.extend_from_slice(&num_channels.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&byte_rate.to_le_bytes());
    buf.extend_from_slice(&block_align.to_le_bytes());
    buf.extend_from_slice(&bits_per_sample.to_le_bytes());

    // data subchunk
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_bytes.to_le_bytes());

    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let pcm = (clamped * 32767.0).round() as i16;
        buf.extend_from_slice(&pcm.to_le_bytes());
    }

    buf
}

/// Full preprocessing pipeline per CONTRACT.md:
/// 1. DC-offset removal
/// 2. Compute quality metrics (`rmsDbfs`, `peak`, `clippingRatio`, `silenceRatio`)
/// 3. Anti-aliased Blackman windowed-sinc resample to 16,000 Hz
/// 4. Gentle peak normalization to -1 dBFS if `0 < peak < 0.5` and not silent
/// 5. Encode to 16-bit PCM mono WAV + base64
pub fn preprocess_and_encode(raw_mono: &[f32], src_rate: u32) -> ProcessedAudio {
    if raw_mono.is_empty() || src_rate == 0 {
        return ProcessedAudio {
            wav_bytes: Vec::new(),
            wav_base64: String::new(),
            duration_ms: 0,
            sample_rate: TARGET_SAMPLE_RATE,
            metrics: QualityMetrics::default(),
        };
    }

    let duration_ms = ((raw_mono.len() as u64) * 1000) / (src_rate as u64);
    let mut working = raw_mono.to_vec();
    remove_dc_offset(&mut working);

    let metrics = compute_quality_metrics(&working, src_rate);
    let mut resampled = resample_blackman_sinc(&working, src_rate, TARGET_SAMPLE_RATE);
    normalize_gentle_peak(&mut resampled, &metrics);

    let wav_bytes = encode_wav_pcm16_mono(&resampled, TARGET_SAMPLE_RATE);
    let wav_base64 = BASE64_STANDARD.encode(&wav_bytes);

    ProcessedAudio {
        wav_bytes,
        wav_base64,
        duration_ms,
        sample_rate: TARGET_SAMPLE_RATE,
        metrics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_downmix_to_mono() {
        let stereo = vec![0.2, 0.6, -0.4, 0.4, 1.0, 0.0];
        let mono = downmix_to_mono(&stereo, 2);
        assert_eq!(mono.len(), 3);
        assert!((mono[0] - 0.4).abs() < 1e-6);
        assert!((mono[1] - 0.0).abs() < 1e-6);
        assert!((mono[2] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_remove_dc_offset() {
        let mut sig = vec![0.35, 0.15, 0.25, 0.25];
        remove_dc_offset(&mut sig);
        let mean: f32 = sig.iter().sum::<f32>() / (sig.len() as f32);
        assert!(mean.abs() < 1e-6);
        assert!((sig[0] - 0.10).abs() < 1e-6);
        assert!((sig[1] + 0.10).abs() < 1e-6);
    }

    #[test]
    fn test_quality_metrics_silence_and_clipping() {
        let sr = 16_000;
        // 1 second completely silent
        let silent = vec![0.0_f32; sr as usize];
        let m_silent = compute_quality_metrics(&silent, sr);
        assert!(m_silent.rms_dbfs <= -99.0);
        assert!((m_silent.silence_ratio - 1.0).abs() < 1e-6);
        assert_eq!(m_silent.clipping_ratio, 0.0);

        // Clipping signal
        let mut clipped = vec![0.5_f32; sr as usize];
        for s in clipped.iter_mut().take(1600) {
            *s = 0.99; // 10% clipped
        }
        let m_clip = compute_quality_metrics(&clipped, sr);
        assert!((m_clip.clipping_ratio - 0.10).abs() < 1e-4);
        assert!((m_clip.silence_ratio - 0.0).abs() < 1e-6);
    }

    #[test]
    fn test_resample_48k_to_16k_preserves_440hz_sine() {
        let src_rate = 48_000_u32;
        let duration_sec = 1;
        let n = (src_rate * duration_sec) as usize;
        let freq = 440.0_f64;
        let input: Vec<f32> = (0..n)
            .map(|i| (0.5 * (2.0 * PI * freq * (i as f64) / (src_rate as f64)).sin()) as f32)
            .collect();

        let resampled = resample_blackman_sinc(&input, src_rate, TARGET_SAMPLE_RATE);
        assert_eq!(resampled.len(), TARGET_SAMPLE_RATE as usize);

        // Verify amplitude in the middle of the signal is preserved near 0.5
        let mid_slice = &resampled[1000..15000];
        let max_amp = mid_slice.iter().fold(0.0_f32, |a, &b| a.max(b.abs()));
        assert!(
            (max_amp - 0.5).abs() < 0.03,
            "Expected peak ~0.5, got {}",
            max_amp
        );
    }

    #[test]
    fn test_gentle_peak_normalization_rules() {
        let sr = 16_000;
        // Case 1: Quiet musical signal with peak 0.2 -> should normalize to -1 dBFS (~0.891)
        let mut quiet_music: Vec<f32> = (0..sr)
            .map(|i| 0.2 * ((2.0 * PI * 440.0 * (i as f64) / (sr as f64)).sin() as f32))
            .collect();
        let metrics = compute_quality_metrics(&quiet_music, sr);
        assert!(normalize_gentle_peak(&mut quiet_music, &metrics));
        let new_peak = quiet_music.iter().fold(0.0_f32, |a, &b| a.max(b.abs()));
        assert!((new_peak - TARGET_NORMALIZE_PEAK).abs() < 1e-3);

        // Case 2: Signal with peak >= 0.5 -> should NOT normalize
        let mut loud_music: Vec<f32> = (0..sr)
            .map(|i| 0.65 * ((2.0 * PI * 440.0 * (i as f64) / (sr as f64)).sin() as f32))
            .collect();
        let loud_metrics = compute_quality_metrics(&loud_music, sr);
        assert!(!normalize_gentle_peak(&mut loud_music, &loud_metrics));

        // Case 3: Silent signal -> should NOT normalize
        let mut near_silence = vec![0.00001_f32; sr as usize];
        let silent_metrics = compute_quality_metrics(&near_silence, sr);
        assert!(!normalize_gentle_peak(&mut near_silence, &silent_metrics));
    }

    #[test]
    fn test_wav_encoding_header_and_size() {
        let samples = vec![0.0_f32, 0.5_f32, -0.5_f32, 1.0_f32, -1.0_f32];
        let wav = encode_wav_pcm16_mono(&samples, 16_000);
        assert_eq!(wav.len(), 44 + samples.len() * 2);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");
        let sr = u32::from_le_bytes([wav[24], wav[25], wav[26], wav[27]]);
        assert_eq!(sr, 16_000);
        let data_len = u32::from_le_bytes([wav[40], wav[41], wav[42], wav[43]]);
        assert_eq!(data_len, 10);
    }
}
