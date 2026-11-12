# Auralis — Shared Contract (source of truth for all clients)

Auralis is an original music-recognition product. Do NOT use Shazam branding, logos or UI copies.

## Brand
- Name: **Auralis** — tagline "Hear it. Know it."
- Dark-only. Colors: midnight `#060A14` (bg), deep `#0B1220` (surface), charcoal `#121A2B` (elevated),
  line `#1E2A40`, text `#EAF2FF`, muted `#8A9BB8`, electric blue `#2F6BFF`, cyan `#22D3EE`, teal `#14B8A6`,
  danger `#FF5A6E`, warn `#FFB547`. Signature gradient: `linear(135deg, #2F6BFF → #22D3EE → #14B8A6)`.
- Mark: a filled circle with three concentric, partially open arcs (sound rings) offset to the right.
- Font: system UI stack (SF Pro / Segoe UI / Inter / Roboto). Title weight 700, tight tracking.

## Recognition states (all clients must implement)
`idle` (Ready to identify) · `requesting_permission` · `listening` · `analyzing` (local quality checks/encoding) ·
`identifying` (network/provider) · `matched` · `no_match` · `mic_unavailable` (denied / no device / disconnected) ·
`connection_error` · `service_unavailable` (provider down / not configured / quota) · `too_quiet` (silence/low level; not uploaded).

## Audio capture rules
- Never record continuously by default. Capture on explicit user action only; visible recording indicator; instant cancel.
- Disable voice processing for music: echoCancellation=false, noiseSuppression=false, autoGainControl=false
  (Android: `MediaRecorder.AudioSource.UNPROCESSED` if supported else `MIC`; iOS: `.measurement` mode).
- Target sample: **10 s** (max 12 s, min 4 s). Encode **WAV PCM 16-bit, mono, 16 000 Hz** for server providers (~320 KB).
- Pre-upload quality gate (compute on the mono signal before resample is fine):
  - `rmsDbfs` overall; `peak`; `clippingRatio` = fraction of samples with |x| ≥ 0.985; `silenceRatio` = fraction of 50 ms windows with RMS < −55 dBFS.
  - If `rmsDbfs < −50` OR `silenceRatio > 0.85` → state `too_quiet`, DO NOT upload ("Move closer to the music or turn it up").
  - If `clippingRatio > 0.05` → still upload, show hint "Input is distorting — lower the volume or move back".
- Preprocessing: DC-offset removal, stereo→mono average, anti-aliased resample to 16 kHz, gentle peak normalisation to −1 dBFS
  only if peak < 0.5. No noise suppression.
- Live level meter during capture must come from the real input (RMS of the most recent ~50 ms, mapped −60..0 dBFS → 0..1).

## HTTP API (server, base `/api/v1`)
All responses JSON. Clients send header `X-Auralis-Client: <platform>/<version>` (web, desktop-macos, desktop-windows,
desktop-linux, android, ios) and `X-Auralis-Install: <random uuid persisted locally>` (used for rate limiting only).
Optional `Authorization: Bearer <sessionToken>` when signed in.

### GET /api/v1/config
```json
{ "providers": [{"id":"audd","name":"AudD","role":"primary","processing":"server","confidence":false}],
  "capture": {"targetSeconds":10,"maxSeconds":12,"minSeconds":4,"sampleRate":16000,"maxUploadBytes":1048576},
  "disclosure": "A ~10-second audio sample is sent to our server and processed by AudD to identify the song. It is not stored.",
  "shazamkitTokens": true, "accounts": true }
```

### POST /api/v1/recognize  (multipart/form-data)
Fields: `audio` (WAV file), `source` = `microphone|system|file`, `durationMs` (int), optional `provider` (must be enabled).
- 200 match / no match:
```json
{ "status":"match", "requestId":"...", "latencyMs":1830,
  "provider": {"id":"audd","name":"AudD"},
  "result": TrackMatch }
{ "status":"no_match", "requestId":"...", "latencyMs":1500, "provider":{"id":"audd","name":"AudD"} }
```
- Errors: `{ "error": { "code": "...", "message": "human readable", "retryable": true|false } }`
  codes → HTTP: `AUDIO_TOO_SHORT` 422, `AUDIO_SILENT` 422, `UNSUPPORTED_FORMAT` 415, `PAYLOAD_TOO_LARGE` 413,
  `RATE_LIMITED` 429 (+`Retry-After`), `PROVIDER_AUTH` 503, `PROVIDER_QUOTA` 503, `PROVIDER_UNAVAILABLE` 503,
  `NOT_CONFIGURED` 503, `UNAUTHORIZED` 401, `INTERNAL` 500.

### TrackMatch (normalised result — identical across providers, incl. on-device ShazamKit)
```json
{ "id": "isrc:USUM71703861 | <provider>:<providerTrackId> | hash",
  "title": "string", "artists": ["string"], "artist": "display string",
  "album": "string|null", "releaseDate": "YYYY-MM-DD|YYYY|null", "year": 2017,
  "genres": ["Pop"], "label": "string|null", "isrc": "string|null", "durationMs": 233000,
  "artwork": { "url": "https://... (largest)", "thumbUrl": "https://...", "width": 1000, "height": 1000 } | null,
  "previewUrl": "https://... | null",
  "links": [ { "service": "spotify|apple_music|youtube|youtube_music|deezer|songlink|musicbrainz|shazam", "url": "https://...", "label": "Spotify" } ],
  "match": { "provider": "audd|acrcloud|shazamkit|local", "offsetMs": 61000|null, "timecode": "01:01"|null,
             "confidence": { "value": 92, "scale": 100 } | null,
             "recognizedAt": "ISO-8601", "source": "microphone|system|file", "platform": "web|android|ios|desktop-macos|..." } }
```
Rules: only include links the provider actually returned (never construct guessed URLs except deterministic ones derived from
provider IDs, e.g. `https://open.spotify.com/track/<spotifyId>`, `https://www.youtube.com/watch?v=<vid>`, `https://www.deezer.com/track/<id>`).
`confidence` is non-null ONLY when the provider supplies a real score (ACRCloud `score`, local engine). AudD/ShazamKit → null.

### GET /api/v1/shazamkit/token
Returns a short-lived (1 h) ES256 ShazamKit developer JWT generated server-side from the `.p8` key: `{ "token": "...", "expiresAt": "ISO" }`.
503 `NOT_CONFIGURED` if Apple credentials are absent. Rate limited.

### Accounts & sync (optional; local history works without an account)
- `POST /api/v1/auth/register` `{email,password}` → `{ token, user:{id,email} }`
- `POST /api/v1/auth/login` `{email,password}` → `{ token, user }`
- `GET /api/v1/library?since=<ISO>` → `{ items: LibraryItem[], serverTime }`
- `POST /api/v1/library/sync` `{ items: LibraryItem[] }` (upsert, last-write-wins by `updatedAt`; `deleted:true` tombstones) → `{ items, serverTime }`
- `DELETE /api/v1/library` → clears all; `DELETE /api/v1/account` → deletes user and all data.
LibraryItem = `{ id (uuid), track: TrackMatch, favorite: bool, createdAt, updatedAt, deleted?: bool }`.

## Local storage (every client)
History stores ONLY metadata (LibraryItem). Raw audio is never persisted unless a user explicitly opts in (no client does by default).
Must survive app upgrades (versioned schema + migrations).

## Desktop native capture (Tauri commands; JS ↔ Rust)
- `audio_capabilities()` → `{ microphone: true, system: { supported: bool, method: "wasapi-loopback|screencapturekit|pulse-monitor|none", reason: string|null } }`
- `list_audio_inputs()` → `[{ id, name, isDefault, kind: "microphone"|"system" }]`
- `start_capture({ deviceId|null, mode: "microphone"|"system", maxSeconds })` → starts; emits event `auralis://level` `{ rms: 0..1, peak: 0..1 }` ~20×/s;
  emits `auralis://capture-ended` `{ reason: "complete"|"cancelled"|"device_lost"|"error", message? }`.
- `stop_capture({ cancel: bool })` → `{ wavBase64, durationMs, sampleRate: 16000, metrics: { rmsDbfs, peak, clippingRatio, silenceRatio } }`
  (`wavBase64` empty when cancel=true).
