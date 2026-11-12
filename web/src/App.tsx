import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ActiveCaptureHandle,
  type CaptureSessionResult,
  decodeAudioFileToWav,
  getPlatformAudioCapabilities,
  listAudioInputDevices,
  type LiveLevelUpdate,
  startAudioCaptureSession,
} from './audio/capture';
import { preprocessAndEncodeWav } from './audio/dsp';
import {
  clearCloudLibrary,
  ClientApiError,
  deleteCloudAccount,
  fetchReferenceTracks,
  fetchServerConfig,
  loginAccount,
  registerAccount,
  submitRecognitionSample,
  syncCloudLibrary,
} from './services/api';
import {
  addTrackToLibrary,
  clearLocalLibrary,
  deleteLibraryEntry,
  exportLibraryAsJsonFile,
  getApiBaseUrl,
  getAuthUser,
  hasShownMicConsent,
  loadAllLibraryItemsWithTombstones,
  loadLibraryItems,
  markMicConsentShown,
  replaceLibraryFromSync,
  setApiBaseUrl,
  setAuthSession,
  toggleLibraryFavorite,
} from './services/storage';
import type {
  AudioInputDevice,
  AudioMetrics,
  CaptureSource,
  DesktopCapabilities,
  LibraryItem,
  RecognitionState,
  ReferenceTrack,
  ServerConfig,
  TrackMatch,
} from './types';
import { APP_BUILD_NUMBER, APP_VERSION, SUPPORTED_PLATFORMS } from './version';
import { CreatorFooter } from './components/CreatorFooter';
import { DownloadPage } from './components/DownloadPage';

type ActiveTab = 'listen' | 'library' | 'studio' | 'settings' | 'download';
type DateFilter = 'all' | 'today' | '7d' | '30d';
type TestCondition = 'clean' | 'speaker' | 'noisy' | 'echo' | 'quiet';

const STATE_LABELS: Record<RecognitionState, { badge: string; title: string; subtitle: string }> = {
  idle: {
    badge: 'Ready to identify',
    title: 'Tap to identify music around you',
    subtitle: 'Listen via microphone, capture system audio, or upload an audio clip.',
  },
  requesting_permission: {
    badge: 'Requesting permission',
    title: 'Waiting for audio access...',
    subtitle: 'Please approve microphone or system audio access in the prompt.',
  },
  listening: {
    badge: 'Listening live',
    title: 'Listening for music...',
    subtitle: 'Hold your device steady toward the sound source. Capture stops automatically.',
  },
  analyzing: {
    badge: 'Analyzing audio',
    title: 'Checking audio quality & normalizing...',
    subtitle: 'Converting sample to 16 kHz mono PCM and verifying signal level.',
  },
  identifying: {
    badge: 'Identifying song',
    title: 'Matching acoustic fingerprint...',
    subtitle: 'Comparing constellation peaks against the recognition catalog.',
  },
  matched: {
    badge: 'Song recognized',
    title: 'Match found',
    subtitle: 'Identified via acoustic fingerprinting.',
  },
  no_match: {
    badge: 'No match found',
    title: 'Could not identify this song',
    subtitle: 'We did not find a confident match in the catalog. Try moving closer to the speaker and listening again.',
  },
  too_quiet: {
    badge: 'Audio too quiet',
    title: 'Only silence or very low audio was detected',
    subtitle: 'Move closer to the speaker or increase the playback volume. The silent sample was not uploaded.',
  },
  mic_unavailable: {
    badge: 'Microphone unavailable',
    title: 'Audio input could not be accessed',
    subtitle: 'Check that a microphone is connected and browser/OS microphone permission is granted.',
  },
  connection_error: {
    badge: 'Connection error',
    title: 'Could not reach the recognition server',
    subtitle: 'Check your network connection and try again.',
  },
  service_unavailable: {
    badge: 'Recognition service unavailable',
    title: 'Recognition provider is temporarily unavailable',
    subtitle: 'The configured recognition service encountered an error or quota limit.',
  },
};

function getInitialTab(): ActiveTab {
  if (typeof window !== 'undefined') {
    const path = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    if (path.includes('download') || search.includes('download')) {
      return 'download';
    }
  }
  return 'listen';
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(getInitialTab);

  const navigateToTab = useCallback((tab: ActiveTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.history) {
      if (tab === 'download') {
        window.history.pushState(null, '', '/download');
      } else if (window.location.pathname.includes('download')) {
        window.history.pushState(null, '', '/');
      }
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const path = window.location.pathname.toLowerCase();
      const search = window.location.search.toLowerCase();
      if (path.includes('download') || search.includes('download')) {
        setActiveTab('download');
      } else {
        setActiveTab('listen');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const [state, setState] = useState<RecognitionState>('idle');
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [clippingHint, setClippingHint] = useState<boolean>(false);

  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [capabilities, setCapabilities] = useState<DesktopCapabilities | null>(null);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
  const [captureMode, setCaptureMode] = useState<'microphone' | 'system'>('microphone');

  const [liveLevel, setLiveLevel] = useState<{ rms: number; rmsDbfs: number; elapsedMs: number }>({
    rms: 0,
    rmsDbfs: -120,
    elapsedMs: 0,
  });
  const [lastMetrics, setLastMetrics] = useState<AudioMetrics | null>(null);
  const [currentMatch, setCurrentMatch] = useState<TrackMatch | null>(null);
  const [currentLibraryItemId, setCurrentLibraryItemId] = useState<string | null>(null);

  const [library, setLibrary] = useState<LibraryItem[]>(() => loadLibraryItems());
  const [searchQuery, setSearchQuery] = useState('');
  const [artistFilter, setArtistFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const [referenceTracks, setReferenceTracks] = useState<ReferenceTrack[]>([]);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [testCondition, setTestCondition] = useState<TestCondition>('clean');

  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Auth & Settings state
  const [authUser, setAuthUserState] = useState<{ id: string; email: string } | null>(() => getAuthUser());
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [customApiUrl, setCustomApiUrl] = useState(() => getApiBaseUrl());

  const captureHandleRef = useRef<ActiveCaptureHandle | null>(null);
  const abortReqRef = useRef<AbortController | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const jukeboxAudioRef = useRef<HTMLAudioElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3400);
  }, []);

  // Load initial config, capabilities, input devices, and reference tracks
  const refreshEnvironment = useCallback(async () => {
    fetchServerConfig()
      .then(setServerConfig)
      .catch(() => {});
    fetchReferenceTracks()
      .then(setReferenceTracks)
      .catch(() => {});
    getPlatformAudioCapabilities()
      .then(setCapabilities)
      .catch(() => {});
    listAudioInputDevices()
      .then((list) => {
        setDevices(list);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshEnvironment();
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const onDeviceChange = () => {
      listAudioInputDevices()
        .then(setDevices)
        .catch(() => {});
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [refreshEnvironment]);

  // Draw radial audio-reactive spectrum bars on canvas
  const drawSpectrum = useCallback((spectrum: Float32Array | null, rms: number, isListening: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (!isListening) return;
    const cx = w / 2;
    const cy = h / 2;
    const baseRadius = 106;
    const bars = 48;

    for (let i = 0; i < bars; i++) {
      const angle = (i / bars) * Math.PI * 2 - Math.PI / 2;
      const val = spectrum ? spectrum[i % spectrum.length] : rms * 0.6;
      const barLen = 6 + val * 42;
      const x1 = cx + Math.cos(angle) * baseRadius;
      const y1 = cy + Math.sin(angle) * baseRadius;
      const x2 = cx + Math.cos(angle) * (baseRadius + barLen);
      const y2 = cy + Math.sin(angle) * (baseRadius + barLen);

      ctx.strokeStyle = i % 2 === 0 ? 'rgba(34, 211, 238, 0.85)' : 'rgba(47, 107, 255, 0.78)';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }, []);

  // Process a captured or decoded WAV sample through the quality gate and recognition server
  const runRecognitionPipeline = useCallback(
    async (wavBytes: Uint8Array, metrics: AudioMetrics, source: CaptureSource) => {
      setLastMetrics(metrics);
      setClippingHint(metrics.clippingRatio > 0.05);
      setState('analyzing');

      // Pre-upload quality gate per docs/CONTRACT.md
      if (metrics.rmsDbfs < -50 || metrics.silenceRatio > 0.85) {
        setState('too_quiet');
        setStatusDetail(
          `Measured signal level was ${metrics.rmsDbfs.toFixed(1)} dBFS (${Math.round(metrics.silenceRatio * 100)}% silence). Move closer to the music or raise the volume.`,
        );
        return;
      }

      setState('identifying');
      setStatusDetail(null);
      const abortCtrl = new AbortController();
      abortReqRef.current = abortCtrl;

      try {
        const res = await submitRecognitionSample({
          wavBytes,
          source,
          durationMs: metrics.durationMs,
          signal: abortCtrl.signal,
        });
        if (res.audioMetrics) {
          const serverMetrics = res.audioMetrics;
          setLastMetrics((prev) => ({
            ...metrics,
            ...prev,
            ...serverMetrics,
            byteLength: serverMetrics.byteLength ?? wavBytes.byteLength,
          }));
        }

        if (res.status === 'match' && res.result) {
          setCurrentMatch(res.result);
          const { item, all } = addTrackToLibrary(res.result);
          setCurrentLibraryItemId(item.id);
          setLibrary(all);
          setState('matched');
          if (authUser) {
            syncCloudLibrary(loadAllLibraryItemsWithTombstones())
              .then((synced) => setLibrary(replaceLibraryFromSync(synced.items)))
              .catch(() => {});
          }
        } else {
          setState('no_match');
          setStatusDetail(`Checked via ${res.provider.name} (${res.latencyMs} ms). No matching track found in catalog.`);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          setState('idle');
          return;
        }
        if (err instanceof ClientApiError) {
          setStatusDetail(err.message);
          if (err.code === 'AUDIO_SILENT' || err.code === 'AUDIO_TOO_SHORT') {
            setState('too_quiet');
          } else if (err.code === 'CONNECTION_ERROR') {
            setState('connection_error');
          } else {
            setState('service_unavailable');
          }
        } else {
          setStatusDetail(String(err?.message ?? err));
          setState('connection_error');
        }
      } finally {
        abortReqRef.current = null;
      }
    },
    [authUser],
  );

  // Start live microphone or system audio capture
  const beginListening = useCallback(
    async (bypassConsentModal = false) => {
      if (!isOnline) {
        setState('connection_error');
        setStatusDetail('You are currently offline. Song recognition requires a connection to the recognition catalog.');
        return;
      }
      if (captureMode === 'microphone' && !hasShownMicConsent() && !bypassConsentModal) {
        setShowConsentModal(true);
        return;
      }
      if (bypassConsentModal) {
        markMicConsentShown();
        setShowConsentModal(false);
      }

      setStatusDetail(null);
      setClippingHint(false);
      setState('requesting_permission');
      setLiveLevel({ rms: 0, rmsDbfs: -120, elapsedMs: 0 });

      const targetSeconds = serverConfig?.capture.targetSeconds ?? 10;

      try {
        const handle = await startAudioCaptureSession({
          mode: captureMode,
          deviceId: selectedDeviceId === 'default' ? null : selectedDeviceId,
          targetSeconds,
          onLevel: (update: LiveLevelUpdate) => {
            setLiveLevel({
              rms: update.rms,
              rmsDbfs: update.rmsDbfs,
              elapsedMs: update.elapsedMs,
            });
            if (update.clipping) setClippingHint(true);
            drawSpectrum(update.spectrum, update.rms, true);
          },
          onComplete: (result: CaptureSessionResult) => {
            captureHandleRef.current = null;
            drawSpectrum(null, 0, false);
            if (!result.cancelled) {
              void runRecognitionPipeline(result.wavBytes, result.metrics, captureMode);
            }
          },
          onError: (code, message) => {
            captureHandleRef.current = null;
            drawSpectrum(null, 0, false);
            setStatusDetail(message);
            if (code === 'permission_denied' || code === 'device_lost' || code === 'unsupported') {
              setState('mic_unavailable');
            }
          },
        });
        captureHandleRef.current = handle;
        setState('listening');
        // Refresh device labels now that permission is granted
        listAudioInputDevices()
          .then(setDevices)
          .catch(() => {});
      } catch {
        // Error state already set by onError callback
      }
    },
    [captureMode, drawSpectrum, isOnline, runRecognitionPipeline, selectedDeviceId, serverConfig?.capture.targetSeconds],
  );

  const cancelListening = useCallback(async () => {
    if (captureHandleRef.current) {
      await captureHandleRef.current.cancel();
      captureHandleRef.current = null;
    }
    if (abortReqRef.current) {
      abortReqRef.current.abort();
      abortReqRef.current = null;
    }
    drawSpectrum(null, 0, false);
    setLiveLevel({ rms: 0, rmsDbfs: -120, elapsedMs: 0 });
    setState('idle');
    setStatusDetail(null);
  }, [drawSpectrum]);

  const stopAndIdentifyEarly = useCallback(async () => {
    if (captureHandleRef.current) {
      const handle = captureHandleRef.current;
      captureHandleRef.current = null;
      drawSpectrum(null, 0, false);
      const res = await handle.stop();
      if (!res.cancelled && res.wavBytes.byteLength > 44) {
        await runRecognitionPipeline(res.wavBytes, res.metrics, captureMode);
      }
    }
  }, [captureMode, drawSpectrum, runRecognitionPipeline]);

  // Keyboard shortcut: Spacebar to start/cancel on Listen tab
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && activeTab === 'listen' && !showConsentModal) {
        e.preventDefault();
        if (state === 'listening' || state === 'identifying') {
          void cancelListening();
        } else {
          void beginListening();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab, beginListening, cancelListening, showConsentModal, state]);

  // Handle Audio File Upload recognition
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        setState('analyzing');
        setStatusDetail(`Decoding "${file.name}"...`);
        const { wavBytes, metrics } = await decodeAudioFileToWav(file, serverConfig?.capture.maxSeconds ?? 12);
        await runRecognitionPipeline(wavBytes, metrics, 'file');
      } catch {
        setState('service_unavailable');
        setStatusDetail('Unsupported or corrupted audio file format. Please upload a valid WAV, MP3, M4A, FLAC, or OGG file.');
      }
    },
    [runRecognitionPipeline, serverConfig?.capture.maxSeconds],
  );

  // Test Studio: Run an instant acoustic fingerprint test on a reference track with a selectable acoustic condition
  const runReferenceTrackTest = useCallback(
    async (track: ReferenceTrack, condition: TestCondition) => {
      setActiveTab('listen');
      setState('analyzing');
      setStatusDetail(`Fetching reference clip "${track.title}" (${condition} condition)...`);
      try {
        const res = await fetch(`${track.audioUrl}?startSec=4&durationSec=8`);
        const ab = await res.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 16000 });
        const decoded = await audioCtx.decodeAudioData(ab.slice(0));
        await audioCtx.close();

        const fullChannel = decoded.getChannelData(0);
        const raw =
          fullChannel.length > 12 * 16000
            ? fullChannel.subarray(4 * 16000, 12 * 16000)
            : fullChannel;
        const modified = new Float32Array(raw.length);

        if (condition === 'clean') {
          modified.set(raw);
        } else if (condition === 'quiet') {
          for (let i = 0; i < raw.length; i++) modified[i] = raw[i] * 0.04; // -28 dB attenuation
        } else if (condition === 'noisy') {
          for (let i = 0; i < raw.length; i++) {
            const noise = (Math.random() * 2 - 1) * 0.12;
            modified[i] = Math.max(-0.98, Math.min(0.98, raw[i] + noise));
          }
        } else if (condition === 'echo') {
          const d1 = Math.floor(0.065 * 16000);
          const d2 = Math.floor(0.145 * 16000);
          for (let i = 0; i < raw.length; i++) {
            let v = raw[i];
            if (i >= d1) v += 0.35 * raw[i - d1];
            if (i >= d2) v += 0.2 * raw[i - d2];
            modified[i] = Math.max(-0.98, Math.min(0.98, v));
          }
        } else if (condition === 'speaker') {
          // Simulated external speaker bandpass (220Hz - 4200Hz)
          let hp = 0;
          let prevIn = 0;
          let lp = 0;
          for (let i = 0; i < raw.length; i++) {
            const x = Math.tanh(raw[i] * 1.3);
            hp = 0.92 * (hp + x - prevIn);
            prevIn = x;
            lp = lp + 0.62 * (hp - lp);
            modified[i] = lp;
          }
        }

        const { wavBytes, metrics } = preprocessAndEncodeWav(modified, 16000);
        await runRecognitionPipeline(wavBytes, metrics, 'microphone');
      } catch (err: any) {
        setState('connection_error');
        setStatusDetail(`Could not load reference track audio: ${err?.message ?? err}`);
      }
    },
    [runRecognitionPipeline],
  );

  // Filtered library items
  const uniqueArtists = useMemo(() => {
    const set = new Set<string>();
    for (const item of library) {
      if (item.track.artist) set.add(item.track.artist);
    }
    return [...set].sort();
  }, [library]);

  const filteredLibrary = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    return library.filter((item) => {
      if (favoritesOnly && !item.favorite) return false;
      if (artistFilter !== 'all' && item.track.artist !== artistFilter) return false;
      if (dateFilter !== 'all') {
        const ageMs = now - Date.parse(item.createdAt);
        if (dateFilter === 'today' && ageMs > 86_400_000) return false;
        if (dateFilter === '7d' && ageMs > 7 * 86_400_000) return false;
        if (dateFilter === '30d' && ageMs > 30 * 86_400_000) return false;
      }
      if (!q) return true;
      return (
        item.track.title.toLowerCase().includes(q) ||
        item.track.artist.toLowerCase().includes(q) ||
        (item.track.album ?? '').toLowerCase().includes(q) ||
        (item.track.isrc ?? '').toLowerCase().includes(q)
      );
    });
  }, [artistFilter, dateFilter, favoritesOnly, library, searchQuery]);

  const currentItemFavorite = useMemo(() => {
    if (!currentLibraryItemId) return false;
    return library.find((i) => i.id === currentLibraryItemId)?.favorite ?? false;
  }, [currentLibraryItemId, library]);

  const handleShareTrack = useCallback(
    async (track: TrackMatch) => {
      const shareText = `${track.title} — ${track.artist}${track.album ? ` (${track.album})` : ''}`;
      const shareUrl = track.links[0]?.url ?? window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: track.title, text: `Identified with PlayIT: ${shareText}`, url: shareUrl });
          return;
        } catch {
          // User cancelled or share failed; fall back to clipboard
        }
      }
      await navigator.clipboard?.writeText(`${shareText} ${shareUrl}`);
      showToast('Copied song link & details to clipboard');
    },
    [showToast],
  );

  const handleCopyTrack = useCallback(
    async (track: TrackMatch) => {
      const text = `${track.title} — ${track.artist}`;
      await navigator.clipboard?.writeText(text);
      showToast(`Copied "${text}"`);
    },
    [showToast],
  );

  const handleAuthSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setAuthStatus('Processing...');
      try {
        const out =
          authMode === 'register'
            ? await registerAccount(authEmail, authPassword)
            : await loginAccount(authEmail, authPassword);
        setAuthSession(out.token, out.user);
        setAuthUserState(out.user);
        setAuthPassword('');
        setAuthStatus('Signed in! Synchronizing your library...');
        const synced = await syncCloudLibrary(loadAllLibraryItemsWithTombstones());
        setLibrary(replaceLibraryFromSync(synced.items));
        setAuthStatus('Cloud library synchronized.');
      } catch (err: any) {
        setAuthStatus(err?.message ?? 'Authentication failed.');
      }
    },
    [authEmail, authMode, authPassword],
  );

  const isListening = state === 'listening';
  const isBusy = state === 'requesting_permission' || state === 'listening' || state === 'analyzing' || state === 'identifying';
  const ringScale1 = isListening ? 1 + liveLevel.rms * 0.24 : 1;
  const ringScale2 = isListening ? 1 + liveLevel.rms * 0.42 : 1;
  const ringScale3 = isListening ? 1 + liveLevel.rms * 0.62 : 1;
  const stateCopy = STATE_LABELS[state];
  const primaryProviderName =
    serverConfig?.providers.find((p) => p.role === 'primary')?.name ?? 'PlayIT Acoustic Engine';

  return (
    <div className="app-shell">
      {/* Top Navigation Bar */}
      <header className="topbar">
        <div
          className="brand-lockup"
          onClick={() => navigateToTab('listen')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && navigateToTab('listen')}
        >
          <svg className="brand-mark" viewBox="0 0 512 512" fill="none" aria-hidden="true">
            <rect width="512" height="512" rx="124" fill="#0B132B" />
            <rect x="2" y="2" width="508" height="508" rx="122" stroke="url(#brandGrad)" strokeWidth="2.5" strokeOpacity="0.32" />
            <path
              d="M196 168 C196 156 208 148 219 154 L340 242 C350 248 350 264 340 270 L219 358 C208 364 196 356 196 344 Z"
              fill="url(#brandGrad)"
            />
            <path d="M372 192 A 80 80 0 0 1 372 320" stroke="url(#brandGrad)" strokeWidth="20" strokeLinecap="round" opacity="0.95" />
            <path d="M414 156 A 136 136 0 0 1 414 356" stroke="url(#brandGrad)" strokeWidth="17" strokeLinecap="round" strokeOpacity="0.65" />
            <path d="M452 124 A 190 190 0 0 1 452 388" stroke="url(#brandGrad)" strokeWidth="14" strokeLinecap="round" strokeOpacity="0.35" />
            <defs>
              <linearGradient id="brandGrad" x1="64" y1="64" x2="448" y2="448" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#2F6BFF" />
                <stop offset="55%" stopColor="#22D3EE" />
                <stop offset="100%" stopColor="#14B8A6" />
              </linearGradient>
            </defs>
          </svg>
          <div>
            <span className="brand-title">PlayIT</span>
            <span className="brand-tagline">Hear it. Know it.</span>
          </div>
        </div>

        <nav className="desktop-nav" aria-label="Primary Navigation">
          <button
            type="button"
            className={`nav-pill ${activeTab === 'listen' ? 'active' : ''}`}
            onClick={() => navigateToTab('listen')}
          >
            Identify
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === 'library' ? 'active' : ''}`}
            onClick={() => navigateToTab('library')}
          >
            Library
            <span className="badge-count">{library.length}</span>
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === 'studio' ? 'active' : ''}`}
            onClick={() => navigateToTab('studio')}
          >
            Acoustic Test Studio
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => navigateToTab('settings')}
          >
            Settings & Privacy
          </button>
          <button
            type="button"
            className={`nav-pill download-pill ${activeTab === 'download' ? 'active' : ''}`}
            onClick={() => navigateToTab('download')}
          >
            <span style={{ marginRight: '4px' }}>⬇</span>
            Download App
          </button>
        </nav>

        <div className="status-cluster">
          <span className="provider-pill" title="Synchronized across Web, Android, iOS, macOS, Windows, and Linux">
            v{APP_VERSION} · Build #{APP_BUILD_NUMBER}
          </span>
          <span className="provider-pill" title="Active recognition engine">
            <span className="dot-live" style={{ background: isOnline ? '#14b8a6' : '#ff5a6e' }} />
            {isOnline ? primaryProviderName : 'Offline Mode (Library Only)'}
          </span>
        </div>
      </header>

      {/* Hidden Audio Element for Reference Jukebox playback */}
      <audio
        ref={jukeboxAudioRef}
        onEnded={() => setPlayingTrackId(null)}
        onPause={() => setPlayingTrackId(null)}
        style={{ display: 'none' }}
      />

      {/* Hidden File Input for Audio File Recognition */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* TAB 1: LISTEN & IDENTIFY WORKSPACE */}
      {activeTab === 'listen' && (
        <div className="workspace-grid">
          <main>
            <section className="listen-stage" aria-live="polite">
              {/* Native App Download Banner in Hero */}
              <div className="download-cta-banner">
                <div className="download-cta-left">
                  <span className="download-cta-tag">NATIVE APPS</span>
                  <span className="download-cta-text">
                    Get PlayIT on <strong>Android, iOS, Windows, macOS & Linux</strong>
                  </span>
                </div>
                <button
                  type="button"
                  className="download-cta-btn"
                  onClick={() => navigateToTab('download')}
                >
                  Download Free App ↓
                </button>
              </div>

              <div className={`stage-status-chip ${isListening ? 'recording' : ''}`}>
                <span
                  className="dot-live"
                  style={{
                    background: isListening ? '#ff5a6e' : state === 'matched' ? '#14b8a6' : '#22d3ee',
                  }}
                />
                {stateCopy.badge}
              </div>

              <h1 className="stage-headline">{stateCopy.title}</h1>
              <p className="stage-subline">{statusDetail ?? stateCopy.subtitle}</p>

              {/* Central Audio-Reactive Orb */}
              <div className="orb-container">
                <canvas ref={canvasRef} className="orb-spectrum-canvas" width={320} height={320} />
                <div
                  className="orb-ring r3"
                  style={{
                    transform: `scale(${ringScale3})`,
                    opacity: isListening ? 0.4 + liveLevel.rms * 0.5 : 0.2,
                  }}
                />
                <div
                  className="orb-ring r2"
                  style={{
                    transform: `scale(${ringScale2})`,
                    opacity: isListening ? 0.55 + liveLevel.rms * 0.45 : 0.32,
                  }}
                />
                <div
                  className="orb-ring r1"
                  style={{
                    transform: `scale(${ringScale1})`,
                    opacity: isListening ? 0.75 + liveLevel.rms * 0.25 : 0.45,
                  }}
                />

                <button
                  type="button"
                  className={`listen-orb-button ${isListening ? 'active-listening' : ''}`}
                  onClick={() => {
                    if (isBusy) {
                      void cancelListening();
                    } else {
                      void beginListening();
                    }
                  }}
                  aria-label={isBusy ? 'Cancel recognition' : 'Identify song'}
                >
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    {isListening ? (
                      <>
                        <path d="M2 10v3" strokeLinecap="round" />
                        <path d="M6 6v11" strokeLinecap="round" />
                        <path d="M10 3v18" strokeLinecap="round" />
                        <path d="M14 8v7" strokeLinecap="round" />
                        <path d="M18 5v13" strokeLinecap="round" />
                        <path d="M22 10v3" strokeLinecap="round" />
                      </>
                    ) : (
                      <>
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" strokeLinecap="round" />
                        <line x1="12" x2="12" y1="19" y2="22" strokeLinecap="round" />
                      </>
                    )}
                  </svg>
                  <span className="orb-label-main">
                    {isListening
                      ? 'Listening...'
                      : state === 'analyzing'
                        ? 'Analyzing...'
                        : state === 'identifying'
                          ? 'Matching...'
                          : 'Identify Song'}
                  </span>
                  <span className="orb-label-sub">
                    {isListening
                      ? `${(liveLevel.elapsedMs / 1000).toFixed(1)}s / ${serverConfig?.capture.targetSeconds ?? 10}s (Tap to cancel)`
                      : 'Tap or press Space'}
                  </span>
                </button>
              </div>

              {/* Live Audio Level Telemetry & Early Stop Controls */}
              {isListening && (
                <div className="telemetry-bar">
                  <span className="telemetry-pill">
                    Input Level: {liveLevel.rmsDbfs > -100 ? `${liveLevel.rmsDbfs.toFixed(1)} dBFS` : 'Silent'}
                  </span>
                  {clippingHint && (
                    <span className="telemetry-pill warn">
                      Input is distorting — move slightly back or lower volume
                    </span>
                  )}
                  {liveLevel.elapsedMs >= 3500 && (
                    <button type="button" className="btn-secondary" onClick={() => void stopAndIdentifyEarly()}>
                      Identify Now ({(liveLevel.elapsedMs / 1000).toFixed(1)}s captured)
                    </button>
                  )}
                  <button type="button" className="btn-danger" onClick={() => void cancelListening()}>
                    Stop
                  </button>
                </div>
              )}

              {/* Helpful Retry / Failure Banner for non-idle error states */}
              {(state === 'no_match' ||
                state === 'too_quiet' ||
                state === 'mic_unavailable' ||
                state === 'connection_error' ||
                state === 'service_unavailable') && (
                <div
                  className={`state-banner ${
                    state === 'mic_unavailable' || state === 'connection_error' || state === 'service_unavailable'
                      ? 'error'
                      : ''
                  }`}
                >
                  <div>
                    <div className="state-banner-title">{stateCopy.badge}</div>
                    <div className="state-banner-desc">{statusDetail ?? stateCopy.subtitle}</div>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => void beginListening()}>
                    Try Again
                  </button>
                </div>
              )}

              {/* Capture Source, Microphone Selector & File Upload Controls */}
              <div className="capture-controls-grid">
                <div className="control-box">
                  <label className="control-label" htmlFor="capture-mode-select">
                    Audio Capture Mode
                  </label>
                  <select
                    id="capture-mode-select"
                    className="control-select"
                    value={captureMode}
                    disabled={isBusy}
                    onChange={(e) => setCaptureMode(e.target.value as 'microphone' | 'system')}
                  >
                    <option value="microphone">Microphone (Universal)</option>
                    <option value="system" disabled={capabilities ? !capabilities.system.supported : false}>
                      System / Tab Audio {capabilities?.system.supported ? `(${capabilities.system.method})` : '(Unavailable)'}
                    </option>
                  </select>
                </div>

                <div className="control-box">
                  <label className="control-label" htmlFor="mic-device-select">
                    Preferred Audio Input
                  </label>
                  <select
                    id="mic-device-select"
                    className="control-select"
                    value={selectedDeviceId}
                    disabled={isBusy || captureMode === 'system'}
                    onChange={(e) => setSelectedDeviceId(e.target.value)}
                  >
                    <option value="default">System Default Microphone</option>
                    {devices
                      .filter((d) => d.kind === 'microphone' && d.id !== 'default')
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  title="Identify a song from a local WAV, MP3, M4A, FLAC, or OGG file"
                >
                  Identify Audio File
                </button>
              </div>

              <p className="privacy-microcopy">
                {serverConfig?.disclosure ??
                  'A short ~10-second audio sample is processed to identify the song and immediately discarded. PlayIT never records in the background.'}
              </p>

              {/* Phase 3 Diagnostic Audio-Analysis Layer */}
              {(isListening || lastMetrics) && (
                <div
                  style={{
                    marginTop: '18px',
                    padding: '14px 16px',
                    borderRadius: '14px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-line)',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  aria-label="Audio Signal Diagnostics"
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '10px',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                      Audio Capture & Fingerprint Diagnostics
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Source: {captureMode === 'system' ? 'System / Tab Audio Loopback' : 'Microphone Input'} · 16,000 Hz Mono PCM16 WAV
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                      gap: '8px',
                      fontSize: '0.77rem',
                    }}
                  >
                    <div style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ color: 'var(--text-muted)' }}>Input Status</div>
                      <div style={{ fontWeight: 700, color: '#14b8a6' }}>
                        {isListening
                          ? `Active (${captureMode === 'system' ? 'System Audio' : 'Microphone'})`
                          : 'Sample Captured'}
                      </div>
                    </div>
                    <div style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ color: 'var(--text-muted)' }}>RMS / Peak Level</div>
                      <div style={{ fontWeight: 700 }}>
                        {isListening
                          ? `${liveLevel.rmsDbfs > -100 ? liveLevel.rmsDbfs.toFixed(1) : '-120.0'} dBFS`
                          : `${lastMetrics?.rmsDbfs.toFixed(1)} dBFS (Peak ${((lastMetrics?.peak ?? 0) * 100).toFixed(0)}%)`}
                      </div>
                    </div>
                    <div style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ color: 'var(--text-muted)' }}>Silence / Clipping</div>
                      <div style={{ fontWeight: 700 }}>
                        {lastMetrics
                          ? `${Math.round(lastMetrics.silenceRatio * 100)}% silence · ${(lastMetrics.clippingRatio * 100).toFixed(1)}% clip`
                          : liveLevel.rmsDbfs > -50
                            ? 'Musical Signal Detected'
                            : 'Waiting for signal...'}
                      </div>
                    </div>
                    <div style={{ padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                      <div style={{ color: 'var(--text-muted)' }}>Duration & Fingerprint</div>
                      <div style={{ fontWeight: 700 }}>
                        {lastMetrics
                          ? `${(lastMetrics.durationMs / 1000).toFixed(1)}s${lastMetrics.fingerprintHashCount ? ` · ${lastMetrics.fingerprintHashCount} hashes` : ''}`
                          : `${(liveLevel.elapsedMs / 1000).toFixed(1)}s elapsed`}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Exceptional Song Identification Results Card */}
            {currentMatch && (
              <section className="result-showcase" aria-label="Identified Song Result">
                {currentMatch.artwork?.url && (
                  <div
                    className="result-backdrop-blur"
                    style={{ backgroundImage: `url(${currentMatch.artwork.url})` }}
                  />
                )}
                <div className="result-content">
                  <div className="artwork-frame">
                    {currentMatch.artwork?.url ? (
                      <img
                        className="artwork-img"
                        src={currentMatch.artwork.url}
                        alt={`${currentMatch.title} album cover`}
                        loading="eager"
                      />
                    ) : (
                      <img className="artwork-img" src="/icon.svg" alt="Fallback album cover" />
                    )}
                  </div>

                  <div>
                    <div className="result-meta-badges">
                      <span className="meta-chip accent">
                        Identified via {currentMatch.match.provider.toUpperCase()}
                      </span>
                      {currentMatch.match.timecode && (
                        <span className="meta-chip">Matched at {currentMatch.match.timecode}</span>
                      )}
                      {currentMatch.match.confidence && (
                        <span className="meta-chip">
                          Confidence: {currentMatch.match.confidence.value}/{currentMatch.match.confidence.scale}
                        </span>
                      )}
                      {lastMetrics && (
                        <span className="meta-chip">{lastMetrics.rmsDbfs.toFixed(1)} dBFS sample</span>
                      )}
                    </div>

                    <h2 className="result-song-title">{currentMatch.title}</h2>
                    <div className="result-song-artist">{currentMatch.artist}</div>

                    <div className="result-facts-grid">
                      {currentMatch.album && (
                        <div className="fact-item">
                          <strong>Album</strong>
                          {currentMatch.album}
                        </div>
                      )}
                      {(currentMatch.releaseDate || currentMatch.year) && (
                        <div className="fact-item">
                          <strong>Released</strong>
                          {currentMatch.releaseDate ?? currentMatch.year}
                        </div>
                      )}
                      {currentMatch.genres.length > 0 && (
                        <div className="fact-item">
                          <strong>Genre</strong>
                          {currentMatch.genres.join(', ')}
                        </div>
                      )}
                      {currentMatch.label && (
                        <div className="fact-item">
                          <strong>Label</strong>
                          {currentMatch.label}
                        </div>
                      )}
                      {currentMatch.isrc && (
                        <div className="fact-item">
                          <strong>ISRC</strong>
                          {currentMatch.isrc}
                        </div>
                      )}
                    </div>

                    {/* Genuine Streaming Provider Links */}
                    {currentMatch.links.length > 0 && (
                      <div className="streaming-links-row">
                        {currentMatch.links.map((link) => (
                          <a
                            key={`${link.service}-${link.url}`}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="stream-pill"
                          >
                            <span>Listen on {link.label}</span>
                            <span aria-hidden="true">↗</span>
                          </a>
                        ))}
                      </div>
                    )}

                    {/* Result Actions */}
                    <div className="result-actions-row">
                      {currentLibraryItemId && (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setLibrary(toggleLibraryFavorite(currentLibraryItemId));
                            showToast(currentItemFavorite ? 'Removed from Favorites' : 'Saved to Favorites');
                          }}
                        >
                          {currentItemFavorite ? '★ Favorited' : '☆ Add to Favorites'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void handleShareTrack(currentMatch)}
                      >
                        Share Result
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => void handleCopyTrack(currentMatch)}
                      >
                        Copy Song Name
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => {
                          void beginListening();
                        }}
                      >
                        Identify Another Song
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </main>

          {/* Right Sidebar: Recent Discoveries & Quick Reference Test */}
          <aside className="side-panel">
            <div className="panel-header">
              <h2 className="panel-title">Recent Discoveries</h2>
              {library.length > 0 && (
                <button type="button" className="btn-secondary" onClick={() => setActiveTab('library')}>
                  View All ({library.length})
                </button>
              )}
            </div>

            {library.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.55 }}>
                <p style={{ marginBottom: '12px' }}>
                  Songs you identify appear here automatically. Your history is saved locally without requiring an account.
                </p>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%' }}
                  onClick={() => setActiveTab('studio')}
                >
                  Open Acoustic Test Studio →
                </button>
              </div>
            ) : (
              <div className="discovery-list">
                {library.slice(0, 6).map((item) => (
                  <div
                    key={item.id}
                    className="discovery-row"
                    onClick={() => {
                      setCurrentMatch(item.track);
                      setCurrentLibraryItemId(item.id);
                      setState('matched');
                    }}
                  >
                    <img
                      className="discovery-thumb"
                      src={item.track.artwork?.thumbUrl ?? item.track.artwork?.url ?? '/icon.svg'}
                      alt=""
                    />
                    <div className="discovery-info">
                      <div className="discovery-title">
                        {item.favorite ? '★ ' : ''}
                        {item.track.title}
                      </div>
                      <div className="discovery-artist">{item.track.artist}</div>
                      <div className="discovery-time">
                        {new Date(item.createdAt).toLocaleDateString()} ·{' '}
                        {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quick Speaker-to-Mic / Direct Fingerprint Verification Card */}
            {referenceTracks.length > 0 && (
              <div
                style={{
                  marginTop: '22px',
                  paddingTop: '18px',
                  borderTop: '1px solid var(--border-line)',
                }}
              >
                <div className="panel-header" style={{ marginBottom: '8px' }}>
                  <h3 style={{ fontSize: '0.92rem', fontWeight: 700 }}>Instant Reference Verification</h3>
                </div>
                <p style={{ fontSize: '0.79rem', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.45 }}>
                  Test the live constellation-peak acoustic fingerprinting engine against a reference song or play it out loud through your speakers:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {referenceTracks.slice(0, 3).map((rt) => (
                    <div
                      key={rt.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {rt.title}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                          {rt.artists.join(', ')} · {rt.genres[0]}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{ padding: '6px 10px', fontSize: '0.76rem' }}
                          onClick={() => {
                            const audio = jukeboxAudioRef.current;
                            if (!audio) return;
                            if (playingTrackId === rt.id) {
                              audio.pause();
                              setPlayingTrackId(null);
                            } else {
                              audio.src = rt.audioUrl;
                              void audio.play();
                              setPlayingTrackId(rt.id);
                              showToast(`Playing "${rt.title}" — tap Identify Song to test speaker-to-mic!`);
                            }
                          }}
                        >
                          {playingTrackId === rt.id ? 'Pause' : 'Play'}
                        </button>
                        <button
                          type="button"
                          className="btn-primary"
                          style={{ padding: '6px 10px', fontSize: '0.76rem' }}
                          onClick={() => void runReferenceTrackTest(rt, 'clean')}
                        >
                          Identify
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* TAB 2: RECOGNITION HISTORY & LIBRARY */}
      {activeTab === 'library' && (
        <section className="section-card" style={{ marginTop: '24px' }}>
          <div className="panel-header" style={{ flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: '1.45rem', fontWeight: 800 }}>Recognition History & Library</h1>
              <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {library.length} recognized {library.length === 1 ? 'song' : 'songs'} · Only song metadata is stored (never raw audio recordings).
              </p>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-secondary"
                disabled={library.length === 0}
                onClick={() => exportLibraryAsJsonFile(library)}
              >
                Export JSON
              </button>
              {library.length > 0 && (
                <button type="button" className="btn-danger" onClick={() => setShowClearConfirm(true)}>
                  Clear History
                </button>
              )}
            </div>
          </div>

          <div className="filters-toolbar">
            <input
              type="search"
              className="search-input"
              placeholder="Search by song title, artist, album, or ISRC..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="filter-select"
              value={artistFilter}
              onChange={(e) => setArtistFilter(e.target.value)}
              aria-label="Filter by artist"
            >
              <option value="all">All Artists ({uniqueArtists.length})</option>
              {uniqueArtists.map((artist) => (
                <option key={artist} value={artist}>
                  {artist}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              aria-label="Filter by date"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
            <button
              type="button"
              className={favoritesOnly ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              {favoritesOnly ? '★ Favorites Only' : '☆ All Saved'}
            </button>
          </div>

          {filteredLibrary.length === 0 ? (
            <div style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '1rem', marginBottom: '12px' }}>No matching songs in your recognition history.</p>
              <button type="button" className="btn-primary" onClick={() => setActiveTab('listen')}>
                Identify a Song
              </button>
            </div>
          ) : (
            <div className="library-grid">
              {filteredLibrary.map((item) => (
                <article key={item.id} className="jukebox-card">
                  <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                    <img
                      src={item.track.artwork?.thumbUrl ?? item.track.artwork?.url ?? '/icon.svg'}
                      alt={item.track.title}
                      style={{ width: '68px', height: '68px', borderRadius: '12px', objectFit: 'cover' }}
                    />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '1rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.track.title}
                      </div>
                      <div style={{ fontSize: '0.88rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                        {item.track.artist}
                      </div>
                      {item.track.album && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{item.track.album}</div>
                      )}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {new Date(item.createdAt).toLocaleDateString()} at{' '}
                        {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                        {item.track.match.platform} ({item.track.match.provider})
                      </div>
                    </div>
                  </div>

                  {item.track.links.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {item.track.links.map((l) => (
                        <a
                          key={`${item.id}-${l.service}`}
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="stream-pill"
                          style={{ padding: '5px 11px', fontSize: '0.76rem' }}
                        >
                          {l.label} ↗
                        </a>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: 'auto' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ flex: 1, padding: '7px 10px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setLibrary(toggleLibraryFavorite(item.id));
                      }}
                    >
                      {item.favorite ? '★ Favorited' : '☆ Favorite'}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: '7px 10px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setCurrentMatch(item.track);
                        setCurrentLibraryItemId(item.id);
                        setState('matched');
                        setActiveTab('listen');
                      }}
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      className="btn-danger"
                      style={{ padding: '7px 10px', fontSize: '0.8rem' }}
                      onClick={() => {
                        setLibrary(deleteLibraryEntry(item.id));
                        showToast('Removed entry from history');
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: ACOUSTIC TEST STUDIO & REFERENCE CATALOG JUKEBOX */}
      {activeTab === 'studio' && (
        <section className="section-card" style={{ marginTop: '24px' }}>
          <div className="panel-header" style={{ flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: '1.45rem', fontWeight: 800 }}>Acoustic Test Studio & Reference Catalog</h1>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', marginTop: '4px', maxWidth: '780px' }}>
                Validate PlayIT recognition accuracy across clean studio audio, external speaker coloration, noisy environments, room echo, and low-volume playback — or play any track out loud through your speakers and identify it via microphone.
              </p>
            </div>
            <div className="control-box" style={{ minWidth: '250px' }}>
              <label className="control-label" htmlFor="condition-select">
                Simulated Acoustic Condition
              </label>
              <select
                id="condition-select"
                className="control-select"
                value={testCondition}
                onChange={(e) => setTestCondition(e.target.value as TestCondition)}
              >
                <option value="clean">Clean Studio Audio (8.0s slice @ t=4.0s)</option>
                <option value="speaker">External Speaker Simulation (220–4200 Hz + saturation)</option>
                <option value="noisy">Noisy Environment (Additive background noise)</option>
                <option value="echo">Room Echo / Reverberation (65ms + 145ms reflections)</option>
                <option value="quiet">Low-Volume Music (-28 dB attenuation)</option>
              </select>
            </div>
          </div>

          <div className="jukebox-grid">
            {referenceTracks.map((rt) => (
              <div key={rt.id} className="jukebox-card">
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  <img
                    src={rt.artworkUrl ?? '/icon.svg'}
                    alt={rt.title}
                    style={{ width: '64px', height: '64px', borderRadius: '12px', objectFit: 'cover' }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.98rem' }}>{rt.title}</div>
                    <div style={{ color: 'var(--accent-cyan)', fontSize: '0.84rem', fontWeight: 600 }}>
                      {rt.artists.join(', ')}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {rt.genres.join(' · ')} · {rt.bpm} BPM · {rt.hasVocalsFormant ? 'Vocal Formants' : 'Instrumental'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      const audio = jukeboxAudioRef.current;
                      if (!audio) return;
                      if (playingTrackId === rt.id) {
                        audio.pause();
                        setPlayingTrackId(null);
                      } else {
                        audio.src = rt.audioUrl;
                        void audio.play();
                        setPlayingTrackId(rt.id);
                      }
                    }}
                  >
                    {playingTrackId === rt.id ? '⏸ Stop Speaker Playback' : '▶ Play Through Speakers'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => void runReferenceTrackTest(rt, testCondition)}
                  >
                    Identify ({testCondition})
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TAB 4: SETTINGS, CLOUD SYNC & PRIVACY */}
      {activeTab === 'settings' && (
        <div className="workspace-grid" style={{ marginTop: '24px' }}>
          <section className="section-card">
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, marginBottom: '12px' }}>
              Recognition Architecture & Privacy Controls
            </h1>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: '18px' }}>
              PlayIT uses a modular multi-provider recognition architecture. API credentials remain strictly on the backend server and are never exposed in client bundles.
            </p>

            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, marginBottom: '10px' }}>Configured Recognition Providers</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '22px' }}>
              {(serverConfig?.providers ?? []).map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-line)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{p.name}</div>
                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      Mode: {p.processing} · Confidence Score: {p.confidence ? 'Supported' : 'Not supplied by provider'}
                    </div>
                  </div>
                  <span className="meta-chip accent">{p.role.toUpperCase()}</span>
                </div>
              ))}
            </div>

            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, marginBottom: '8px' }}>Server Endpoint Configuration</h2>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '22px' }}>
              <input
                type="url"
                className="search-input"
                style={{ flex: 1 }}
                placeholder="Default (same origin / Vite proxy to :8787)"
                value={customApiUrl}
                onChange={(e) => setCustomApiUrl(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setApiBaseUrl(customApiUrl);
                  void refreshEnvironment();
                  showToast('Updated recognition server URL');
                }}
              >
                Save URL
              </button>
            </div>

            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, marginBottom: '8px' }}>Privacy Commitments</h2>
            <ul style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.65, paddingLeft: '18px', marginBottom: '22px' }}>
              <li>No continuous or hidden background recording: audio capture begins only when you tap Identify Song.</li>
              <li>Short audio samples (~10s, 16 kHz mono PCM) are used solely for acoustic fingerprinting and immediately discarded.</li>
              <li>Silent or ultra-low-volume audio is detected locally and never uploaded.</li>
              <li>Recognition history stores song metadata only — raw microphone recordings are never retained.</li>
            </ul>

            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, marginBottom: '10px' }}>
              Synchronized Cross-Platform Builds (v{APP_VERSION} · Build #{APP_BUILD_NUMBER})
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
              {SUPPORTED_PLATFORMS.map((plat) => (
                <div
                  key={plat.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-line)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.84rem', fontWeight: 700 }}>{plat.name}</div>
                    <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>Release {plat.version}</div>
                  </div>
                  <span className="meta-chip accent">SYNCED</span>
                </div>
              ))}
            </div>
          </section>

          <aside className="side-panel">
            <h2 className="panel-title" style={{ marginBottom: '10px' }}>
              Cloud Library Synchronization
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '16px' }}>
              Your recognition history works locally without an account. Sign in to synchronize your discoveries across Web, Android, iOS, and Desktop.
            </p>

            {authUser ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '10px',
                    background: 'var(--bg-elevated)',
                    fontSize: '0.86rem',
                  }}
                >
                  Signed in as <strong>{authUser.email}</strong>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    const synced = await syncCloudLibrary(loadAllLibraryItemsWithTombstones());
                    setLibrary(replaceLibraryFromSync(synced.items));
                    showToast('Library synchronized with cloud');
                  }}
                >
                  Sync Library Now
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setAuthSession(null, null);
                    setAuthUserState(null);
                    setAuthStatus(null);
                    showToast('Signed out of cloud sync');
                  }}
                >
                  Sign Out
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={async () => {
                    await deleteCloudAccount();
                    clearLocalLibrary();
                    setLibrary([]);
                    setAuthSession(null, null);
                    setAuthUserState(null);
                    showToast('Deleted cloud account and all library data');
                  }}
                >
                  Delete Account & Cloud Data
                </button>
              </div>
            ) : (
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input
                  type="email"
                  required
                  className="search-input"
                  placeholder="Email address"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  className="search-input"
                  placeholder="Password (min 8 chars)"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                />
                <button type="submit" className="btn-primary">
                  {authMode === 'login' ? 'Sign In & Sync' : 'Create Account & Sync'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}
                >
                  {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign In'}
                </button>
                {authStatus && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', marginTop: '4px' }}>{authStatus}</div>
                )}
              </form>
            )}
          </aside>
        </div>
      )}

      {/* TAB 5: DOWNLOAD CENTER */}
      {activeTab === 'download' && (
        <DownloadPage onBackToApp={() => navigateToTab('listen')} />
      )}

      {/* Global Creator Attribution Footer */}
      <CreatorFooter onNavigateDownload={() => navigateToTab('download')} />

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        <button
          type="button"
          className={`nav-pill ${activeTab === 'listen' ? 'active' : ''}`}
          onClick={() => navigateToTab('listen')}
        >
          Identify
        </button>
        <button
          type="button"
          className={`nav-pill ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => navigateToTab('library')}
        >
          Library ({library.length})
        </button>
        <button
          type="button"
          className={`nav-pill ${activeTab === 'studio' ? 'active' : ''}`}
          onClick={() => navigateToTab('studio')}
        >
          Studio
        </button>
        <button
          type="button"
          className={`nav-pill ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => navigateToTab('settings')}
        >
          Privacy
        </button>
        <button
          type="button"
          className={`nav-pill ${activeTab === 'download' ? 'active' : ''}`}
          onClick={() => navigateToTab('download')}
        >
          Download
        </button>
      </nav>

      {/* Pre-Permission Microphone Explanation Modal */}
      {showConsentModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
          <div className="modal-card">
            <h2 id="consent-title" style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '10px' }}>
              Microphone Access for Song Identification
            </h2>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: '14px' }}>
              To identify music playing around you, PlayIT needs temporary access to your microphone to capture a short (~10 second) audio sample.
            </p>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55, paddingLeft: '18px', marginBottom: '18px' }}>
              <li>Capture stops automatically as soon as the sample is collected or when you tap Stop.</li>
              <li>
                {serverConfig?.disclosure ??
                  'The short sample is transmitted securely over HTTPS to our recognition engine and is never stored.'}
              </li>
            </ul>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowConsentModal(false)}>
                Not Now
              </button>
              <button type="button" className="btn-primary" onClick={() => void beginListening(true)}>
                Continue & Grant Access
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clear History Confirmation Modal */}
      {showClearConfirm && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card">
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: '8px' }}>Clear Recognition History?</h2>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '18px' }}>
              This will permanently remove all {library.length} recognized songs from this device
              {authUser ? ' and your synchronized cloud library' : ''}.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={async () => {
                  clearLocalLibrary();
                  setLibrary([]);
                  setCurrentMatch(null);
                  setShowClearConfirm(false);
                  if (authUser) {
                    await clearCloudLibrary().catch(() => {});
                  }
                  showToast('Cleared recognition history');
                }}
              >
                Delete All History
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            bottom: '84px',
            right: '24px',
            zIndex: 90,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--accent-cyan)',
            padding: '10px 16px',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 600,
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
