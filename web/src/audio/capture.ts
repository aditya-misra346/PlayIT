import type { AudioInputDevice, AudioMetrics, DesktopCapabilities } from '../types';
import { dbToNormalizedLevel, preprocessAndEncodeWav, TARGET_SAMPLE_RATE, toDb } from './dsp';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<any>;
    };
  }
}

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__?.invoke);
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!window.__TAURI_INTERNALS__?.invoke) {
    throw new Error('Tauri desktop runtime is not available');
  }
  return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

export async function getPlatformAudioCapabilities(): Promise<DesktopCapabilities> {
  if (isTauriDesktop()) {
    try {
      const caps = await tauriInvoke<{
        microphone: boolean;
        system: { supported: boolean; method: string; reason: string | null };
      }>('audio_capabilities');
      return {
        isDesktopApp: true,
        microphone: caps.microphone,
        system: caps.system,
      };
    } catch (e) {
      return {
        isDesktopApp: true,
        microphone: true,
        system: { supported: false, method: 'none', reason: String(e) },
      };
    }
  }

  const hasGetUserMedia = Boolean(navigator.mediaDevices?.getUserMedia);
  const hasDisplayMedia = Boolean(navigator.mediaDevices?.getDisplayMedia);
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  return {
    isDesktopApp: false,
    microphone: hasGetUserMedia,
    system: {
      supported: hasDisplayMedia && !isMobile,
      method: hasDisplayMedia && !isMobile ? 'browser-display-audio' : 'none',
      reason: isMobile
        ? 'Mobile browsers do not expose internal system audio capture. Use microphone mode or the native Android/Desktop app.'
        : hasDisplayMedia
          ? null
          : 'This browser does not support tab/system audio sharing. Use microphone mode or the Auralis desktop app.',
    },
  };
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (isTauriDesktop()) {
    try {
      return await tauriInvoke<AudioInputDevice[]>('list_audio_inputs');
    } catch {
      // Fallback to browser enumeration if Tauri command fails
    }
  }
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    return audioInputs.map((d, idx) => ({
      id: d.deviceId || `mic-${idx}`,
      name: d.label || `Microphone ${idx + 1}`,
      isDefault: d.deviceId === 'default' || idx === 0,
      kind: 'microphone' as const,
    }));
  } catch {
    return [];
  }
}

export interface LiveLevelUpdate {
  rms: number; // 0..1 normalized (-60..0 dBFS)
  peak: number; // 0..1 linear
  rmsDbfs: number;
  elapsedMs: number;
  spectrum: Float32Array; // 48 bars in 0..1
  clipping: boolean;
}

export interface CaptureSessionResult {
  wavBytes: Uint8Array;
  metrics: AudioMetrics;
  cancelled: boolean;
}

export interface ActiveCaptureHandle {
  stop: () => Promise<CaptureSessionResult>;
  cancel: () => Promise<void>;
}

/**
 * Starts an audio capture session (either via Tauri native backend or Browser Web Audio API).
 * Automatically finishes when `targetSeconds` is reached, or earlier if `stop()` / `cancel()` is called.
 */
export async function startAudioCaptureSession(opts: {
  mode: 'microphone' | 'system';
  deviceId: string | null;
  targetSeconds: number;
  onLevel: (update: LiveLevelUpdate) => void;
  onComplete: (result: CaptureSessionResult) => void;
  onError: (code: 'permission_denied' | 'device_lost' | 'unsupported', message: string) => void;
}): Promise<ActiveCaptureHandle> {
  if (isTauriDesktop()) {
    return startTauriNativeCapture(opts);
  }
  return startBrowserWebAudioCapture(opts);
}

async function startTauriNativeCapture(opts: {
  mode: 'microphone' | 'system';
  deviceId: string | null;
  targetSeconds: number;
  onLevel: (update: LiveLevelUpdate) => void;
  onComplete: (result: CaptureSessionResult) => void;
  onError: (code: 'permission_denied' | 'device_lost' | 'unsupported', message: string) => void;
}): Promise<ActiveCaptureHandle> {
  const startMs = Date.now();
  let stopped = false;

  await tauriInvoke('start_capture', {
    args: {
      deviceId: opts.deviceId,
      mode: opts.mode,
      maxSeconds: opts.targetSeconds,
    },
  });

  const pollTimer = window.setInterval(() => {
    if (stopped) return;
    const elapsedMs = Date.now() - startMs;
    if (elapsedMs >= opts.targetSeconds * 1000) {
      void finish(false);
    }
  }, 150);

  async function finish(cancel: boolean): Promise<CaptureSessionResult> {
    if (stopped) {
      return {
        wavBytes: new Uint8Array(0),
        metrics: { rmsDbfs: -120, peak: 0, clippingRatio: 0, silenceRatio: 1, durationMs: 0 },
        cancelled: true,
      };
    }
    stopped = true;
    window.clearInterval(pollTimer);
    const res = await tauriInvoke<{
      wavBase64: string;
      durationMs: number;
      sampleRate: number;
      metrics: { rmsDbfs: number; peak: number; clippingRatio: number; silenceRatio: number };
    }>('stop_capture', { args: { cancel } });

    const binary = cancel || !res.wavBase64 ? '' : atob(res.wavBase64);
    const wavBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) wavBytes[i] = binary.charCodeAt(i);

    const out: CaptureSessionResult = {
      wavBytes,
      metrics: { ...res.metrics, durationMs: res.durationMs },
      cancelled: cancel,
    };
    if (!cancel) opts.onComplete(out);
    return out;
  }

  return {
    stop: () => finish(false),
    cancel: async () => {
      await finish(true);
    },
  };
}

async function startBrowserWebAudioCapture(opts: {
  mode: 'microphone' | 'system';
  deviceId: string | null;
  targetSeconds: number;
  onLevel: (update: LiveLevelUpdate) => void;
  onComplete: (result: CaptureSessionResult) => void;
  onError: (code: 'permission_denied' | 'device_lost' | 'unsupported', message: string) => void;
}): Promise<ActiveCaptureHandle> {
  let stream: MediaStream;
  try {
    if (opts.mode === 'system') {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        opts.onError('unsupported', 'System/tab audio capture is not supported in this browser.');
        throw new Error('Unsupported');
      }
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop());
        opts.onError(
          'unsupported',
          'No audio track was shared. Enable "Share tab/system audio" in the browser prompt, or use Microphone mode.',
        );
        throw new Error('No audio track shared');
      }
    } else {
      if (!navigator.mediaDevices?.getUserMedia) {
        opts.onError(
          'unsupported',
          'Microphone access requires HTTPS or localhost and a modern browser with MediaDevices support.',
        );
        throw new Error('No getUserMedia');
      }
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
      };
      if (opts.deviceId && opts.deviceId !== 'default') {
        audioConstraints.deviceId = { exact: opts.deviceId };
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    }
  } catch (err: any) {
    if (err?.message === 'Unsupported' || err?.message === 'No audio track shared' || err?.message === 'No getUserMedia') {
      throw err;
    }
    const name = String(err?.name ?? '');
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      opts.onError(
        'permission_denied',
        'Microphone permission was denied. Grant microphone access in your browser address bar to identify music.',
      );
    } else {
      opts.onError(
        'device_lost',
        'Requested microphone could not be opened. Check that a microphone is connected and not in exclusive use.',
      );
    }
    throw err;
  }

  const audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const inputSampleRate = audioCtx.sampleRate;
  const sourceNode = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.65;

  const processor = audioCtx.createScriptProcessor(2048, 1, 1);
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;

  sourceNode.connect(analyser);
  analyser.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  const chunks: Float32Array[] = [];
  let totalFrames = 0;
  let stopped = false;
  const startMs = Date.now();
  const freqBins = new Uint8Array(analyser.frequencyBinCount);

  const audioTrack = stream.getAudioTracks()[0];
  const onTrackEnded = () => {
    if (!stopped) {
      void cleanup();
      opts.onError('device_lost', 'The audio input device was disconnected during listening.');
    }
  };
  audioTrack?.addEventListener('ended', onTrackEnded);

  processor.onaudioprocess = (ev: AudioProcessingEvent) => {
    if (stopped) return;
    const input = ev.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    totalFrames += copy.length;

    let sumSq = 0;
    let peak = 0;
    let clipped = 0;
    for (let i = 0; i < copy.length; i++) {
      const a = Math.abs(copy[i]);
      sumSq += copy[i] * copy[i];
      if (a > peak) peak = a;
      if (a >= 0.985) clipped++;
    }
    const rmsLinear = Math.sqrt(sumSq / (copy.length || 1));
    const rmsDbfs = toDb(rmsLinear);

    analyser.getByteFrequencyData(freqBins);
    const spectrum = new Float32Array(48);
    for (let i = 0; i < 48; i++) {
      const bin = Math.min(freqBins.length - 1, Math.floor((i / 48) * (freqBins.length * 0.75)) + 1);
      spectrum[i] = freqBins[bin] / 255;
    }

    const elapsedMs = Date.now() - startMs;
    opts.onLevel({
      rms: dbToNormalizedLevel(rmsDbfs),
      peak: Math.min(1, peak),
      rmsDbfs,
      elapsedMs,
      spectrum,
      clipping: clipped / copy.length > 0.02,
    });

    if (totalFrames >= opts.targetSeconds * inputSampleRate) {
      void finish(false);
    }
  };

  async function cleanup(): Promise<void> {
    stopped = true;
    audioTrack?.removeEventListener('ended', onTrackEnded);
    try {
      processor.disconnect();
      analyser.disconnect();
      sourceNode.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    stream.getTracks().forEach((t) => t.stop());
    if (audioCtx.state !== 'closed') {
      await audioCtx.close().catch(() => {});
    }
  }

  async function finish(cancel: boolean): Promise<CaptureSessionResult> {
    if (stopped) {
      return {
        wavBytes: new Uint8Array(0),
        metrics: { rmsDbfs: -120, peak: 0, clippingRatio: 0, silenceRatio: 1, durationMs: 0 },
        cancelled: true,
      };
    }
    await cleanup();
    if (cancel) {
      return {
        wavBytes: new Uint8Array(0),
        metrics: { rmsDbfs: -120, peak: 0, clippingRatio: 0, silenceRatio: 1, durationMs: 0 },
        cancelled: true,
      };
    }

    const merged = new Float32Array(totalFrames);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const { wavBytes, metrics } = preprocessAndEncodeWav(merged, inputSampleRate);
    const result: CaptureSessionResult = { wavBytes, metrics, cancelled: false };
    opts.onComplete(result);
    return result;
  }

  return {
    stop: () => finish(false),
    cancel: async () => {
      await finish(true);
    },
  };
}

/**
 * Decodes an uploaded audio file (.wav, .mp3, .m4a, .ogg, .flac) into a 16 kHz mono 16-bit PCM WAV sample
 * (taking up to 12 seconds from the most energetic section of the file).
 */
export async function decodeAudioFileToWav(file: File, maxSeconds = 12): Promise<{ wavBytes: Uint8Array; metrics: AudioMetrics }> {
  const ab = await file.arrayBuffer();
  const audioCtx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
  try {
    const decoded = await audioCtx.decodeAudioData(ab.slice(0));
    const len = decoded.length;
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : null;
    const mono = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      mono[i] = ch1 ? 0.5 * (ch0[i] + ch1[i]) : ch0[i];
    }

    const maxFrames = Math.floor(maxSeconds * decoded.sampleRate);
    const clip = mono.length > maxFrames ? mono.subarray(0, maxFrames) : mono;
    return preprocessAndEncodeWav(clip, decoded.sampleRate);
  } finally {
    await audioCtx.close().catch(() => {});
  }
}
