import type { TrackMatch } from '../types.js';
import { link, safeMediaUrl, str } from './normalize.js';

/**
 * Enriches a TrackMatch (e.g., from ACRCloud which returns ISRC/Deezer ID but not album cover URLs)
 * via the official public Deezer Track API (`https://api.deezer.com/track/isrc:{isrc}`).
 * Fails silently if offline or not found. Never fabricates URLs.
 */
export async function enrichTrackMetadata(track: TrackMatch, fetchImpl: typeof fetch = fetch): Promise<TrackMatch> {
  if (track.artwork && track.previewUrl) return track;

  let queryUrl: string | null = null;
  if (track.isrc && !track.isrc.startsWith('USARL')) {
    queryUrl = `https://api.deezer.com/track/isrc:${encodeURIComponent(track.isrc)}`;
  } else {
    const dzLink = track.links.find((l) => l.service === 'deezer');
    const m = dzLink?.url.match(/deezer\.com\/track\/(\d+)/);
    if (m) queryUrl = `https://api.deezer.com/track/${m[1]}`;
  }
  if (!queryUrl) return track;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetchImpl(queryUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return track;
    const data: any = await res.json();
    if (!data || data.error || !data.id) return track;

    const coverXl = safeMediaUrl(data.album?.cover_xl ?? data.album?.cover_big);
    const coverMed = safeMediaUrl(data.album?.cover_medium);
    const preview = safeMediaUrl(data.preview);
    const dzTrackLink = link('deezer', data.link);

    const updatedLinks = [...track.links];
    if (dzTrackLink && !updatedLinks.some((l) => l.service === 'deezer')) {
      updatedLinks.push(dzTrackLink);
    }

    return {
      ...track,
      album: track.album ?? str(data.album?.title),
      releaseDate: track.releaseDate ?? str(data.release_date),
      artwork:
        track.artwork ??
        (coverXl
          ? { url: coverXl, thumbUrl: coverMed ?? coverXl, width: 1000, height: 1000 }
          : null),
      previewUrl: track.previewUrl ?? preview,
      links: updatedLinks,
    };
  } catch {
    return track;
  }
}
