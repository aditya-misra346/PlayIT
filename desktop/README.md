# Auralis Desktop (Tauri 2)

Native desktop shell and cross-platform audio-capture layer for **Auralis** ("Hear it. Know it.").

## Architecture

- **Identifier**: `app.auralis.desktop`
- **Product Name**: `Auralis`
- **Frontend**: `../../web/dist` (`devUrl`: `http://localhost:5173`)
- **Rust Backend (`src-tauri/src/capture/`)**:
  - `mod.rs`: Tauri commands (`audio_capabilities`, `list_audio_inputs`, `start_capture`, `stop_capture`), capture session supervisor, ~20 Hz live level emitter (`auralis://level`), and lifecycle events (`auralis://capture-ended`).
  - `dsp.rs`: Pure-Rust music preprocessing pipeline:
    - Multi-channel to mono averaging (`downmix_to_mono`)
    - DC-offset removal (`remove_dc_offset`)
    - Pre-upload quality metrics (`rmsDbfs`, `peak`, `clippingRatio` at `|x| >= 0.985`, `silenceRatio` across 50 ms windows with RMS < -55 dBFS)
    - Anti-aliased Blackman windowed-sinc resampler to 16,000 Hz (`resample_blackman_sinc`)
    - Gentle peak normalization to -1 dBFS (~0.891) only when `0 < peak < 0.5` and signal is not silent
    - 16-bit PCM little-endian mono WAV encoder + Base64 encoding
  - `mic.rs`: Cross-platform microphone input via `cpal` (macOS CoreAudio, Windows WASAPI, Linux ALSA/PulseAudio/PipeWire) with stream disconnect detection (`device_lost`).
  - `macos.rs` + `macos-helper/screencapture_audio.swift`: Native macOS 13+ `ScreenCaptureKit` system audio capture helper (`capturesAudio = true`, `excludesCurrentProcessAudio = true`, 48 kHz mono `f32le` stream, minimal 2×2 video config). Reports clear guidance if Screen & System Audio Recording permission is not granted.
  - `windows.rs`: Windows WASAPI loopback capture via `cpal` on output devices (with note regarding DRM-protected streams and microphone fallback).
  - `linux.rs`: Linux PulseAudio / PipeWire-Pulse monitor source capture (`cpal` monitor device enumeration + `parec --raw --format=float32le --rate=48000 --channels=1 @DEFAULT_MONITOR@` fallback).

## Building & Testing

### 1. Compile macOS ScreenCaptureKit Helper (macOS only)
```bash
./scripts/build-macos-helper.sh
```

### 2. Run Rust Unit Tests
```bash
cd src-tauri
~/.cargo/bin/cargo test
```

### 3. Build Desktop Binary
```bash
cd src-tauri
~/.cargo/bin/cargo build
```
