import { ApiError } from '../errors.js';
import type { ProviderOutcome, RecognitionContext, RecognitionProvider } from '../types.js';
import { buildTrack, link, parseTimecode, safeMediaUrl, str } from './normalize.js';

/**
 * AudD adapter — https://docs.audd.io/
 * POST multipart: api_token, file, return=apple_music,spotify,deezer,musicbrainz
 * AudD does not return a confidence score, so confidence is always null.
 */
export class AudDProvider implements RecognitionProvider {
  readonly id = 'audd' as const;
  readonly name = 'AudD';
  readonly suppliesConfidence = false;
  constructor(
    private readonly opts: { token: string; endpoint: string; costPerRequestUsd: number },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  get costPerRequestUsd() {
    return this.opts.costPerRequestUsd;
  }
  isConfigured() {
    return Boolean(this.opts.token);
  }

  async recognize(wav: Uint8Array, ctx: RecognitionContext, signal: AbortSignal): Promise<ProviderOutcome> {
    if (!this.isConfigured()) throw new ApiError('NOT_CONFIGURED', 'AudD is not configured.');
    const form = new FormData();
    form.set('api_token', this.opts.token);
    form.set('return', 'apple_music,spotify,deezer,musicbrainz');
    form.set('file', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'sample.wav');

    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.endpoint, { method: 'POST', body: form, signal });
    } catch (e) {
      throw new ApiError('PROVIDER_UNAVAILABLE', 'The recognition service could not be reached.', { providerDetail: String(e) });
    }
    if (!res.ok) throw new ApiError('PROVIDER_UNAVAILABLE', `The recognition service returned HTTP ${res.status}.`);
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new ApiError('PROVIDER_UNAVAILABLE', 'The recognition service returned an invalid response.');
    }
    if (body?.status === 'error') throw mapAuddError(body.error);
    if (body?.status !== 'success') throw new ApiError('PROVIDER_UNAVAILABLE', 'Unexpected response from AudD.');
    const r = body.result;
    if (!r || !str(r.title)) return { status: 'no_match', raw: body };
    return { status: 'match', result: normalizeAudd(r, ctx), raw: body };
  }
}

export function mapAuddError(err: any): ApiError {
  const code = Number(err?.error_code);
  const detail = String(err?.error_message ?? '');
  if (code === 900) return new ApiError('PROVIDER_AUTH', 'The recognition service rejected our credentials.', { providerDetail: detail });
  if (code === 901 || code === 902) return new ApiError('PROVIDER_QUOTA', 'The recognition quota has been reached. Please try again later.', { providerDetail: detail });
  if (code === 300) return new ApiError('AUDIO_SILENT', 'The audio could not be analysed. Try again closer to the music.', { providerDetail: detail });
  if (code === 400) return new ApiError('PAYLOAD_TOO_LARGE', 'The audio sample was too large.', { providerDetail: detail });
  if (code === 500 || code === 700) return new ApiError('UNSUPPORTED_FORMAT', 'The audio sample could not be read.', { providerDetail: detail });
  return new ApiError('PROVIDER_UNAVAILABLE', 'The recognition service reported an error.', { providerDetail: `${code}: ${detail}` });
}

export function normalizeAudd(r: any, ctx: RecognitionContext) {
  const am = r.apple_music ?? null;
  const sp = r.spotify ?? null;
  const dz = r.deezer ?? null;
  const mb = Array.isArray(r.musicbrainz) ? r.musicbrainz[0] : null;

  // Artwork preference: Apple Music (templated, up to 3000px) → Spotify largest → Deezer XL.
  let artwork = null as null | { url: string; thumbUrl: string | null; width: number | null; height: number | null };
  const amArt = am?.artwork;
  if (amArt?.url) {
    const w = Math.min(Number(amArt.width) || 1200, 1200);
    const h = Math.min(Number(amArt.height) || 1200, 1200);
    const url = safeMediaUrl(String(amArt.url).replace('{w}', String(w)).replace('{h}', String(h)));
    const thumb = safeMediaUrl(String(amArt.url).replace('{w}', '300').replace('{h}', '300'));
    if (url) artwork = { url, thumbUrl: thumb, width: w, height: h };
  }
  if (!artwork && Array.isArray(sp?.album?.images) && sp.album.images.length) {
    const imgs = [...sp.album.images].sort((a: any, b: any) => (b.width ?? 0) - (a.width ?? 0));
    const big = safeMediaUrl(imgs[0]?.url);
    if (big) artwork = { url: big, thumbUrl: safeMediaUrl(imgs[imgs.length - 1]?.url), width: imgs[0].width ?? null, height: imgs[0].height ?? null };
  }
  if (!artwork && dz?.album?.cover_xl) {
    const big = safeMediaUrl(dz.album.cover_xl);
    if (big) artwork = { url: big, thumbUrl: safeMediaUrl(dz.album.cover_medium), width: 1000, height: 1000 };
  }

  const artistNames: string[] = Array.isArray(sp?.artists) && sp.artists.length
    ? sp.artists.map((a: any) => String(a.name))
    : [String(r.artist)];

  const genres: string[] = Array.isArray(am?.genreNames) ? am.genreNames.filter((g: string) => g !== 'Music') : [];

  return buildTrack(
    'audd',
    {
      title: String(r.title),
      artists: artistNames,
      album: str(r.album) ?? str(am?.albumName) ?? str(sp?.album?.name),
      releaseDate: str(r.release_date) ?? str(am?.releaseDate) ?? str(sp?.album?.release_date),
      genres,
      label: str(r.label),
      isrc: str(am?.isrc) ?? str(sp?.external_ids?.isrc) ?? str(dz?.isrc),
      durationMs: Number(am?.durationInMillis) || Number(sp?.duration_ms) || (Number(dz?.duration) || 0) * 1000 || null,
      artwork,
      previewUrl: am?.previews?.[0]?.url ?? sp?.preview_url ?? dz?.preview ?? null,
      providerTrackId: str(sp?.id) ?? (dz?.id ? String(dz.id) : null),
      offsetMs: parseTimecode(r.timecode),
      confidence: null,
      links: [
        link(
          'spotify',
          sp?.external_urls?.spotify ??
            `https://open.spotify.com/search/${encodeURIComponent(`${r.title} ${artistNames[0] ?? ''}`.trim())}`,
        ),
        link(
          'apple_music',
          am?.url ??
            `https://music.apple.com/us/search?term=${encodeURIComponent(`${r.title} ${artistNames[0] ?? ''}`.trim())}`,
        ),
        link(
          'youtube_music',
          `https://music.youtube.com/search?q=${encodeURIComponent(`${r.title} ${artistNames[0] ?? ''}`.trim())}`,
        ),
        link('deezer', dz?.link),
        link('songlink', r.song_link),
        mb?.id ? link('musicbrainz', `https://musicbrainz.org/recording/${encodeURIComponent(mb.id)}`) : null,
      ],
    },
    ctx,
  );
}
