import type { AudioMetrics, CaptureSource, LibraryItem, ProviderId, ReferenceTrack, ServerConfig, TrackMatch } from '../types';
import { isTauriDesktop } from '../audio/capture';
import { getApiBaseUrl, getAuthToken, getInstallId } from './storage';

export class ClientApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean = false,
    readonly status: number = 500,
  ) {
    super(message);
  }
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const platform = isTauriDesktop() ? 'desktop/1.0' : 'web/1.0';
  const headers: Record<string, string> = {
    'X-Auralis-Client': platform,
    'X-Auralis-Install': getInstallId(),
    ...extra,
  };
  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  return `${base}${path}`;
}

async function handleJsonResponse<T>(res: Response): Promise<T> {
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    throw new ClientApiError('INTERNAL', `Server returned invalid JSON (HTTP ${res.status})`, true, res.status);
  }
  if (!res.ok) {
    const err = body?.error;
    throw new ClientApiError(
      err?.code ?? 'INTERNAL',
      err?.message ?? `Request failed with HTTP ${res.status}`,
      Boolean(err?.retryable),
      res.status,
    );
  }
  return body as T;
}

export async function fetchServerConfig(): Promise<ServerConfig> {
  const res = await fetch(apiUrl('/api/v1/config'), {
    headers: buildHeaders(),
  });
  return handleJsonResponse<ServerConfig>(res);
}

export async function fetchReferenceTracks(): Promise<ReferenceTrack[]> {
  const res = await fetch(apiUrl('/api/v1/reference-tracks'), {
    headers: buildHeaders(),
  });
  const data = await handleJsonResponse<{ tracks: ReferenceTrack[] }>(res);
  return data.tracks.map((t) => ({
    ...t,
    audioUrl: apiUrl(t.audioUrl),
  }));
}

export interface RecognizeApiResult {
  status: 'match' | 'no_match';
  requestId: string;
  latencyMs: number;
  provider: { id: ProviderId; name: string };
  result?: TrackMatch;
  audioMetrics?: AudioMetrics;
}

export async function submitRecognitionSample(opts: {
  wavBytes: Uint8Array;
  source: CaptureSource;
  durationMs: number;
  provider?: ProviderId;
  signal?: AbortSignal;
}): Promise<RecognizeApiResult> {
  const form = new FormData();
  form.set('source', opts.source);
  form.set('durationMs', String(Math.round(opts.durationMs)));
  if (opts.provider) form.set('provider', opts.provider);
  form.set('audio', new Blob([opts.wavBytes as unknown as BlobPart], { type: 'audio/wav' }), 'sample.wav');

  let res: Response;
  try {
    res = await fetch(apiUrl('/api/v1/recognize'), {
      method: 'POST',
      headers: buildHeaders(),
      body: form,
      signal: opts.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    throw new ClientApiError(
      'CONNECTION_ERROR',
      'Could not reach the Auralis recognition server. Check your internet connection.',
      true,
      0,
    );
  }
  return handleJsonResponse<RecognizeApiResult>(res);
}

export async function registerAccount(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
  const res = await fetch(apiUrl('/api/v1/auth/register'), {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });
  return handleJsonResponse(res);
}

export async function loginAccount(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
  const res = await fetch(apiUrl('/api/v1/auth/login'), {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });
  return handleJsonResponse(res);
}

export async function syncCloudLibrary(items: LibraryItem[]): Promise<{ items: LibraryItem[]; serverTime: string }> {
  const res = await fetch(apiUrl('/api/v1/library/sync'), {
    method: 'POST',
    headers: buildHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ items }),
  });
  return handleJsonResponse(res);
}

export async function clearCloudLibrary(): Promise<void> {
  const res = await fetch(apiUrl('/api/v1/library'), {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  await handleJsonResponse(res);
}

export async function deleteCloudAccount(): Promise<void> {
  const res = await fetch(apiUrl('/api/v1/account'), {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  await handleJsonResponse(res);
}
