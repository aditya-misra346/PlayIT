export type ErrorCode =
  | 'AUDIO_TOO_SHORT'
  | 'AUDIO_SILENT'
  | 'UNSUPPORTED_FORMAT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH'
  | 'PROVIDER_QUOTA'
  | 'PROVIDER_UNAVAILABLE'
  | 'NOT_CONFIGURED'
  | 'UNAUTHORIZED'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUDGET_EXCEEDED'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  AUDIO_TOO_SHORT: 422,
  AUDIO_SILENT: 422,
  UNSUPPORTED_FORMAT: 415,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  PROVIDER_AUTH: 503,
  PROVIDER_QUOTA: 503,
  PROVIDER_UNAVAILABLE: 503,
  NOT_CONFIGURED: 503,
  BUDGET_EXCEEDED: 503,
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL: 500,
};

const RETRYABLE: Partial<Record<ErrorCode, boolean>> = {
  RATE_LIMITED: true,
  PROVIDER_UNAVAILABLE: true,
  AUDIO_SILENT: true,
  AUDIO_TOO_SHORT: true,
  INTERNAL: true,
};

export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { retryAfterSec?: number; providerDetail?: string } = {},
  ) {
    super(message);
    this.status = STATUS[code];
    this.retryable = RETRYABLE[code] ?? false;
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, retryable: this.retryable } };
  }
}

/** Errors that justify trying the fallback provider (provider-side failures, never a clean no-match). */
export function isProviderFailure(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    (e.code === 'PROVIDER_UNAVAILABLE' || e.code === 'PROVIDER_QUOTA' || e.code === 'PROVIDER_AUTH' || e.code === 'NOT_CONFIGURED')
  );
}
