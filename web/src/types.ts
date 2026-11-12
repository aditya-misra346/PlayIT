export type RecognitionState =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'analyzing'
  | 'identifying'
  | 'matched'
  | 'no_match'
  | 'mic_unavailable'
  | 'connection_error'
  | 'service_unavailable'
  | 'too_quiet';

export type ProviderId = 'audd' | 'acrcloud' | 'shazamkit' | 'local';
export type CaptureSource = 'microphone' | 'system' | 'file';

export type LinkService =
  | 'spotify'
  | 'apple_music'
  | 'youtube'
  | 'youtube_music'
  | 'deezer'
  | 'songlink'
  | 'musicbrainz'
  | 'shazam';

export interface TrackLink {
  service: LinkService;
  url: string;
  label: string;
}

export interface Artwork {
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface MatchInfo {
  provider: ProviderId;
  offsetMs: number | null;
  timecode: string | null;
  confidence: { value: number; scale: number } | null;
  recognizedAt: string;
  source: CaptureSource;
  platform: string;
}

export interface TrackMatch {
  id: string;
  title: string;
  artists: string[];
  artist: string;
  album: string | null;
  releaseDate: string | null;
  year: number | null;
  genres: string[];
  label: string | null;
  isrc: string | null;
  durationMs: number | null;
  artwork: Artwork | null;
  previewUrl: string | null;
  links: TrackLink[];
  match: MatchInfo;
}

export interface LibraryItem {
  id: string;
  track: TrackMatch;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}

export interface AudioMetrics {
  rmsDbfs: number;
  peak: number;
  clippingRatio: number;
  silenceRatio: number;
  durationMs: number;
  sampleRate?: number;
  channels?: number;
  byteLength?: number;
  fingerprintHashCount?: number;
}

export interface AudioInputDevice {
  id: string;
  name: string;
  isDefault: boolean;
  kind: 'microphone' | 'system';
}

export interface ServerProviderInfo {
  id: ProviderId;
  name: string;
  configured: boolean;
  role: 'primary' | 'fallback' | 'disabled';
  processing: string;
  confidence: boolean;
}

export interface ServerConfig {
  providers: ServerProviderInfo[];
  capture: {
    targetSeconds: number;
    maxSeconds: number;
    minSeconds: number;
    sampleRate: number;
    maxUploadBytes: number;
  };
  disclosure: string;
  shazamkitTokens: boolean;
  accounts: boolean;
  referenceCatalogCount?: number;
}

export interface ReferenceTrack {
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
  category?: 'mainstream' | 'studio';
  previewUrl?: string | null;
  bpm: number;
  timbre: string;
  hasVocalsFormant: boolean;
  audioUrl: string;
}

export interface DesktopCapabilities {
  isDesktopApp: boolean;
  microphone: boolean;
  system: {
    supported: boolean;
    method: string;
    reason: string | null;
  };
}
