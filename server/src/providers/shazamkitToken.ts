import { createPrivateKey, sign } from 'node:crypto';
import { ApiError } from '../errors.js';

export interface ShazamKitConfig {
  teamId: string;
  keyId: string;
  privateKeyPem: string;
  tokenTtlSec: number;
}

function base64Url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Generates an Apple ShazamKit Developer Token (ES256 JWT signed with the .p8 private key).
 * Never exposes the private key to clients; tokens are short-lived (default 1 hour).
 */
export function issueShazamKitDeveloperToken(cfg: ShazamKitConfig, nowMs = Date.now()): { token: string; expiresAt: string } {
  if (!cfg.teamId || !cfg.keyId || !cfg.privateKeyPem) {
    throw new ApiError(
      'NOT_CONFIGURED',
      'ShazamKit developer token signing is not configured on this server (missing APPLE_TEAM_ID, SHAZAMKIT_KEY_ID, or SHAZAMKIT_PRIVATE_KEY).',
    );
  }
  // Apple maximum allowed TTL is 6 months (15,777,000s); we clamp to [300s, 86400s] for short-lived security.
  const ttlSec = Math.max(300, Math.min(86400, cfg.tokenTtlSec || 3600));
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + ttlSec;

  const header = { alg: 'ES256', kid: cfg.keyId, typ: 'JWT' };
  const payload = { iss: cfg.teamId, iat, exp };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  try {
    const keyObj = createPrivateKey(cfg.privateKeyPem);
    const sig = sign('sha256', Buffer.from(signingInput, 'utf8'), {
      key: keyObj,
      dsaEncoding: 'ieee-p1363',
    });
    return {
      token: `${signingInput}.${base64Url(sig)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  } catch (e) {
    throw new ApiError('PROVIDER_AUTH', 'Failed to sign ShazamKit developer token with configured private key.', {
      providerDetail: String(e),
    });
  }
}
