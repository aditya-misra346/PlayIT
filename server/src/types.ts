/** Normalised result shared by every provider and every client. See docs/CONTRACT.md. */
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
  /** Only non-null when the provider returned a genuine score. Never synthesised. */
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

export interface RecognitionContext {
  source: CaptureSource;
  platform: string;
  durationMs: number;
  requestId: string;
}

/** What a provider adapter returns. Errors are thrown as ApiError. */
export type ProviderOutcome =
  | { status: 'match'; result: TrackMatch; raw?: unknown }
  | { status: 'no_match'; raw?: unknown };

export interface RecognitionProvider {
  readonly id: ProviderId;
  readonly name: string;
  /** Whether the provider returns a meaningful confidence score. */
  readonly suppliesConfidence: boolean;
  /** Approximate USD cost per request (for usage tracking / budgets). */
  readonly costPerRequestUsd: number;
  isConfigured(): boolean;
  recognize(wav: Uint8Array, ctx: RecognitionContext, signal: AbortSignal): Promise<ProviderOutcome>;
}

export interface LibraryItem {
  id: string;
  track: TrackMatch;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deleted?: boolean;
}
