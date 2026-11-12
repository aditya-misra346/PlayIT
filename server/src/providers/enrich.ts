import type { TrackMatch } from '../types.js';
import { link, safeMediaUrl, str } from './normalize.js';

function norm(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\s+-\s+.*?(versión|versão|version|remix|edit|live|ao vivo|en vivo|remaster).*$/i, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVariantOrRemixTitle(title: string): boolean {
  return /\b(remix|versión|versão|versao|version|club edit|radio edit|latin remix|notd remix|on vacation version|lofi|flip|ao vivo|en vivo|acústico|acustico|mandelão|mandelaum)\b/i.test(title);
}

function cleanCanonicalTitle(title: string): string {
  return title
    .replace(/\(.*?(remix|versión|versão|version|edit|feat\.|ao vivo|en vivo|acústico).*?\)/gi, '')
    .replace(/\[.*?(remix|versión|versão|version|edit|feat\.|ao vivo|en vivo|acústico).*?\]/gi, '')
    .replace(/\s+-\s+.*?(versión|versão|version|remix|edit|ao vivo|en vivo).*$/i, '')
    .trim();
}

/**
 * Enriches a TrackMatch via official public APIs:
 *   1. Deezer Track API (`https://api.deezer.com/track/isrc:{isrc}`)
 *   2. Apple iTunes Search API (`https://itunes.apple.com/search?term=...&media=music`)
 * Only attaches metadata when artist & track title genuinely correspond to the recognized song.
 * Never fabricates URLs or confidence scores.
 */
export async function enrichTrackMetadata(track: TrackMatch, fetchImpl: typeof fetch = fetch): Promise<TrackMatch> {
  let enriched = { ...track, links: [...track.links] };

  // Ensure standard streaming links (Spotify, Apple Music, YouTube Music) exist for every identified song
  const searchQ = encodeURIComponent(`${enriched.title} ${enriched.artist}`.trim());
  if (!enriched.links.some((l) => l.service === 'spotify')) {
    const sp = link('spotify', `https://open.spotify.com/search/${searchQ}`);
    if (sp) enriched.links.push(sp);
  }
  if (!enriched.links.some((l) => l.service === 'apple_music')) {
    const am = link('apple_music', `https://music.apple.com/us/search?term=${searchQ}`);
    if (am) enriched.links.push(am);
  }
  if (!enriched.links.some((l) => l.service === 'youtube_music')) {
    const ytm = link('youtube_music', `https://music.youtube.com/search?q=${searchQ}`);
    if (ytm) enriched.links.push(ytm);
  }

  const hasVariantSuffix = isVariantOrRemixTitle(enriched.title);

  if (!hasVariantSuffix && enriched.artwork && enriched.previewUrl && enriched.album && enriched.releaseDate) {
    return enriched;
  }

  // Step 1: Deezer ISRC / track ID enrichment
  let queryUrl: string | null = null;
  if (enriched.isrc && !enriched.isrc.startsWith('USARL') && !enriched.isrc.startsWith('ITUNES-')) {
    queryUrl = `https://api.deezer.com/track/isrc:${encodeURIComponent(enriched.isrc)}`;
  } else {
    const dzLink = enriched.links.find((l) => l.service === 'deezer');
    const m = dzLink?.url.match(/deezer\.com\/track\/(\d+)/);
    if (m) queryUrl = `https://api.deezer.com/track/${m[1]}`;
  }

  if (queryUrl) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2200);
      const res = await fetchImpl(queryUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data: any = await res.json();
        if (data && !data.error && data.id) {
          const coverXl = safeMediaUrl(data.album?.cover_xl ?? data.album?.cover_big);
          const coverMed = safeMediaUrl(data.album?.cover_medium);
          const preview = safeMediaUrl(data.preview);
          const dzTrackLink = link('deezer', data.link);
          if (dzTrackLink && !enriched.links.some((l) => l.service === 'deezer')) {
            enriched.links.push(dzTrackLink);
          }
          enriched = {
            ...enriched,
            album: enriched.album ?? str(data.album?.title),
            releaseDate: enriched.releaseDate ?? str(data.release_date),
            artwork:
              enriched.artwork ??
              (coverXl ? { url: coverXl, thumbUrl: coverMed ?? coverXl, width: 1000, height: 1000 } : null),
            previewUrl: enriched.previewUrl ?? preview,
          };
        }
      }
    } catch {
      // Ignore network/timeout errors during enrichment
    }
  }

  // Step 2: Official Apple iTunes Search API enrichment if artwork, previewUrl, album is missing, or variant title needs canonical studio resolution
  if ((hasVariantSuffix || !enriched.artwork || !enriched.previewUrl || !enriched.album) && !enriched.isrc?.startsWith('USARL')) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2200);
      const baseTitle = hasVariantSuffix ? cleanCanonicalTitle(enriched.title) : enriched.title;
      const primaryArtist = (enriched.artists[0] ?? enriched.artist).split(',')[0].trim();
      const itunesTerm = encodeURIComponent(`${baseTitle} ${primaryArtist}`.trim());
      const itunesUrl = `https://itunes.apple.com/search?term=${itunesTerm}&media=music&limit=10`;
      const res = await fetchImpl(itunesUrl, { signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data: any = await res.json();
        const targetTitle = norm(baseTitle);
        const targetArtist = norm(primaryArtist);
        const candidates = (data?.results ?? []).filter((r: any) => {
          if (r.kind !== 'song') return false;
          const rTitle = norm(String(r.trackName ?? ''));
          const rArtist = norm(String(r.artistName ?? ''));
          const titleOk = rTitle === targetTitle || rTitle.includes(targetTitle) || targetTitle.includes(rTitle);
          const artistOk = rArtist.includes(targetArtist) || targetArtist.includes(rArtist);
          return titleOk && artistOk;
        });
        const studioMatch = candidates.find(
          (r: any) => !isVariantOrRemixTitle(`${r.trackName ?? ''} ${r.collectionName ?? ''}`),
        );
        const match = studioMatch ?? candidates[0];

        if (match) {
          const art100 = str(match.artworkUrl100);
          const art1000 = safeMediaUrl(art100 ? art100.replace('100x100bb', '1000x1000bb') : null);
          const thumb300 = safeMediaUrl(art100 ? art100.replace('100x100bb', '300x300bb') : null);
          const preview = safeMediaUrl(match.previewUrl);
          const amUrl = safeMediaUrl(match.trackViewUrl);

          const canonicalTitle = hasVariantSuffix && studioMatch ? (str(match.trackName) ?? enriched.title) : enriched.title;
          const canonicalArtist = hasVariantSuffix && studioMatch ? (str(match.artistName) ?? enriched.artist) : enriched.artist;
          const canonicalSearchQ = encodeURIComponent(`${canonicalTitle} ${canonicalArtist}`.trim());

          if (amUrl) {
            const idx = enriched.links.findIndex((l) => l.service === 'apple_music');
            const amLink = link('apple_music', amUrl);
            if (amLink) {
              if (idx >= 0) enriched.links[idx] = amLink;
              else enriched.links.push(amLink);
            }
          }
          if (hasVariantSuffix && studioMatch) {
            const spIdx = enriched.links.findIndex((l) => l.service === 'spotify');
            const spLink = link('spotify', `https://open.spotify.com/search/${canonicalSearchQ}`);
            if (spLink && spIdx >= 0) enriched.links[spIdx] = spLink;
            const ytIdx = enriched.links.findIndex((l) => l.service === 'youtube_music');
            const ytLink = link('youtube_music', `https://music.youtube.com/search?q=${canonicalSearchQ}`);
            if (ytLink && ytIdx >= 0) enriched.links[ytIdx] = ytLink;
          }

          enriched = {
            ...enriched,
            title: canonicalTitle,
            artist: canonicalArtist,
            artists: hasVariantSuffix && studioMatch ? [canonicalArtist] : enriched.artists,
            album: (hasVariantSuffix && studioMatch ? str(match.collectionName) : null) ?? enriched.album ?? str(match.collectionName),
            releaseDate: enriched.releaseDate ?? (str(match.releaseDate)?.slice(0, 10) ?? null),
            artwork:
              (hasVariantSuffix && studioMatch && art1000
                ? { url: art1000, thumbUrl: thumb300 ?? art1000, width: 1000, height: 1000 }
                : null) ??
              enriched.artwork ??
              (art1000 ? { url: art1000, thumbUrl: thumb300 ?? art1000, width: 1000, height: 1000 } : null),
            previewUrl: enriched.previewUrl ?? preview,
          };
        }
      }
    } catch {
      // Ignore network/timeout errors during enrichment
    }
  }

  return enriched;
}
