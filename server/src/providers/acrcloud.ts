import { createHmac } from 'node:crypto';
import { ApiError } from '../errors.js';
import type { ProviderOutcome, RecognitionContext, RecognitionProvider } from '../types.js';
import { buildTrack, link, str } from './normalize.js';

/**
 * ACRCloud Identification API — POST https://{host}/v1/identify (multipart, HMAC-SHA1 signature v1).
 * Returns a genuine match `score` (0–100), which we surface as confidence.
 */
export class ACRCloudProvider implements RecognitionProvider {
  readonly id = 'acrcloud' as const;
  readonly name = 'ACRCloud';
  readonly suppliesConfidence = true;
  constructor(
    private readonly opts: { host: string; accessKey: string; accessSecret: string; costPerRequestUsd: number },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}
  get costPerRequestUsd() {
    return this.opts.costPerRequestUsd;
  }
  isConfigured() {
    return Boolean(this.opts.host && this.opts.accessKey && this.opts.accessSecret);
  }

  sign(timestamp: string): string {
    const toSign = ['POST', '/v1/identify', this.opts.accessKey, 'audio', '1', timestamp].join('\n');
    return createHmac('sha1', this.opts.accessSecret).update(toSign).digest('base64');
  }

  async recognize(wav: Uint8Array, ctx: RecognitionContext, signal: AbortSignal): Promise<ProviderOutcome> {
    if (!this.isConfigured()) throw new ApiError('NOT_CONFIGURED', 'ACRCloud is not configured.');
    const timestamp = String(Math.floor(this.now() / 1000));
    const form = new FormData();
    form.set('access_key', this.opts.accessKey);
    form.set('data_type', 'audio');
    form.set('signature_version', '1');
    form.set('timestamp', timestamp);
    form.set('signature', this.sign(timestamp));
    form.set('sample_bytes', String(wav.byteLength));
    form.set('sample', new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }), 'sample.wav');

    const host = this.opts.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${host}/v1/identify`, { method: 'POST', body: form, signal });
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
    const code = Number(body?.status?.code);
    if (code === 1001) return { status: 'no_match', raw: body };
    if (code !== 0) throw mapAcrError(code, String(body?.status?.msg ?? ''));
    const music = body?.metadata?.music;
    if (!Array.isArray(music) || !music.length || !str(music[0]?.title)) return { status: 'no_match', raw: body };
    // ACRCloud orders candidates by score; take the best one only.
    return { status: 'match', result: normalizeAcr(music[0], ctx), raw: body };
  }
}

export function mapAcrError(code: number, msg: string): ApiError {
  const d = { providerDetail: `${code}: ${msg}` };
  switch (code) {
    case 3001:
    case 3014:
      return new ApiError('PROVIDER_AUTH', 'The recognition service rejected our credentials.', d);
    case 3003:
      return new ApiError('PROVIDER_QUOTA', 'The recognition quota has been reached. Please try again later.', d);
    case 3015:
      return new ApiError('PROVIDER_UNAVAILABLE', 'The recognition service is busy. Please try again in a moment.', d);
    case 3016:
      return new ApiError('PAYLOAD_TOO_LARGE', 'The audio sample was too large.', d);
    case 2004:
      return new ApiError('AUDIO_SILENT', 'The audio could not be fingerprinted. Try again closer to the music.', d);
    default:
      return new ApiError('PROVIDER_UNAVAILABLE', 'The recognition service reported an error.', d);
  }
}

export function normalizeAcr(m: any, ctx: RecognitionContext) {
  const ext = m.external_metadata ?? {};
  const spotifyId = str(ext.spotify?.track?.id);
  const deezerId = ext.deezer?.track?.id ? String(ext.deezer.track.id) : null;
  const ytVid = str(ext.youtube?.vid);
  const score = Number(m.score);
  return buildTrack(
    'acrcloud',
    {
      title: String(m.title),
      artists: Array.isArray(m.artists) ? m.artists.map((a: any) => String(a.name)) : [],
      album: str(m.album?.name),
      releaseDate: str(m.release_date),
      genres: Array.isArray(m.genres) ? m.genres.map((g: any) => String(g.name)) : [],
      label: str(m.label),
      isrc: str(m.external_ids?.isrc),
      durationMs: Number(m.duration_ms) || null,
      artwork: null, // ACRCloud identify does not return artwork; enriched from Deezer by ISRC/ID when available.
      providerTrackId: str(m.acrid),
      offsetMs: Number.isFinite(Number(m.play_offset_ms)) ? Number(m.play_offset_ms) : null,
      confidence: Number.isFinite(score) && score > 0 ? { value: Math.round(score), scale: 100 } : null,
      // Deterministic URLs built only from IDs ACRCloud returned.
      links: [
        spotifyId ? link('spotify', `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}`) : null,
        deezerId ? link('deezer', `https://www.deezer.com/track/${encodeURIComponent(deezerId)}`) : null,
        ytVid ? link('youtube', `https://www.youtube.com/watch?v=${encodeURIComponent(ytVid)}`) : null,
        ytVid ? link('youtube_music', `https://music.youtube.com/watch?v=${encodeURIComponent(ytVid)}`) : null,
      ],
    },
    ctx,
  );
}
