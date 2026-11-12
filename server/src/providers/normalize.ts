import { createHash } from 'node:crypto';
import type { Artwork, LinkService, MatchInfo, ProviderId, RecognitionContext, TrackLink, TrackMatch } from '../types.js';

export const LINK_LABELS: Record<LinkService, string> = {
  spotify: 'Spotify',
  apple_music: 'Apple Music',
  youtube: 'YouTube',
  youtube_music: 'YouTube Music',
  deezer: 'Deezer',
  songlink: 'All platforms',
  musicbrainz: 'MusicBrainz',
  shazam: 'Shazam',
};

const SAFE_HOSTS = [
  'open.spotify.com', 'music.apple.com', 'itunes.apple.com', 'geo.music.apple.com', 'www.youtube.com', 'youtube.com',
  'music.youtube.com', 'youtu.be', 'www.deezer.com', 'deezer.com', 'lis.tn', 'song.link', 'album.link', 'musicbrainz.org', 'www.shazam.com',
];

/** Only allow https links to known music services; drops anything malformed (defence against injected javascript: URLs). */
export function safeUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const url = new URL(u);
    if (url.protocol !== 'https:') return null;
    if (!SAFE_HOSTS.includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Artwork/preview URLs: https only, any CDN host. */
export function safeMediaUrl(u: unknown): string | null {
  if (typeof u !== 'string' || !u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function link(service: LinkService, url: unknown): TrackLink | null {
  const safe = safeUrl(url);
  return safe ? { service, url: safe, label: LINK_LABELS[service] } : null;
}

export function formatTimecode(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function parseTimecode(tc: unknown): number | null {
  if (typeof tc !== 'string') return null;
  const parts = tc.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export interface TrackDraft {
  title: string;
  artists: string[];
  album?: string | null;
  releaseDate?: string | null;
  genres?: string[];
  label?: string | null;
  isrc?: string | null;
  durationMs?: number | null;
  artwork?: Artwork | null;
  previewUrl?: string | null;
  links?: (TrackLink | null)[];
  providerTrackId?: string | null;
  offsetMs?: number | null;
  confidence?: MatchInfo['confidence'];
}

export function buildTrack(provider: ProviderId, d: TrackDraft, ctx: RecognitionContext): TrackMatch {
  const artists = d.artists.map((a) => a.trim()).filter(Boolean);
  const releaseDate = str(d.releaseDate);
  const yearMatch = releaseDate?.match(/^(\d{4})/);
  const isrc = str(d.isrc)?.toUpperCase() ?? null;
  const id = isrc
    ? `isrc:${isrc}`
    : d.providerTrackId
      ? `${provider}:${d.providerTrackId}`
      : `hash:${createHash('sha1').update(`${d.title}\u0000${artists.join(',')}`.toLowerCase()).digest('hex').slice(0, 16)}`;
  const seen = new Set<string>();
  const links = (d.links ?? []).filter((l): l is TrackLink => {
    if (!l || seen.has(l.service)) return false;
    seen.add(l.service);
    return true;
  });
  const offsetMs = d.offsetMs ?? null;
  return {
    id,
    title: d.title.trim(),
    artists,
    artist: artists.join(', '),
    album: str(d.album),
    releaseDate,
    year: yearMatch ? Number(yearMatch[1]) : null,
    genres: [...new Set((d.genres ?? []).filter(Boolean))],
    label: str(d.label),
    isrc,
    durationMs: d.durationMs && d.durationMs > 0 ? Math.round(d.durationMs) : null,
    artwork: d.artwork ?? null,
    previewUrl: safeMediaUrl(d.previewUrl),
    links,
    match: {
      provider,
      offsetMs,
      timecode: formatTimecode(offsetMs),
      confidence: d.confidence ?? null,
      recognizedAt: new Date().toISOString(),
      source: ctx.source,
      platform: ctx.platform,
    },
  };
}

/** Split "A feat. B & C" style artist strings conservatively (only on explicit separators the provider used). */
export function splitArtists(s: string | null): string[] {
  if (!s) return [];
  return s.split(/\s*(?:,|;| feat\. | ft\. | & | x )\s*/i).filter(Boolean).length > 1 ? [s] : [s];
}
