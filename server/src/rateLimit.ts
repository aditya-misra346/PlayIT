import { ApiError } from './errors.js';

interface Bucket {
  minuteWindowStart: number;
  minuteCount: number;
  dayKey: string;
  dayCount: number;
}

/**
 * Per-identity (userId, install UUID, or client IP) rate limiter enforcing both per-minute burst
 * limits and daily recognition quotas so commercial API costs stay bounded.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limits: {
      perMinute: number;
      perDay: number;
      perDayAnonymous: number;
    },
    private readonly now: () => number = () => Date.now(),
  ) {}

  checkAndConsume(identityKey: string, isAuthenticated: boolean): void {
    const nowMs = this.now();
    const dayKey = new Date(nowMs).toISOString().slice(0, 10);
    let b = this.buckets.get(identityKey);
    if (!b) {
      b = { minuteWindowStart: nowMs, minuteCount: 0, dayKey, dayCount: 0 };
      this.buckets.set(identityKey, b);
    }
    if (nowMs - b.minuteWindowStart >= 60_000) {
      b.minuteWindowStart = nowMs;
      b.minuteCount = 0;
    }
    if (b.dayKey !== dayKey) {
      b.dayKey = dayKey;
      b.dayCount = 0;
    }

    if (b.minuteCount >= this.limits.perMinute) {
      const retryAfterSec = Math.max(1, Math.ceil((60_000 - (nowMs - b.minuteWindowStart)) / 1000));
      throw new ApiError('RATE_LIMITED', `Rate limit reached (${this.limits.perMinute} recognitions/min). Please wait ${retryAfterSec}s.`, {
        retryAfterSec,
      });
    }

    const maxDay = isAuthenticated ? this.limits.perDay : this.limits.perDayAnonymous;
    if (b.dayCount >= maxDay) {
      throw new ApiError('RATE_LIMITED', `Daily recognition limit (${maxDay}/day) reached.`, {
        retryAfterSec: 3600,
      });
    }

    b.minuteCount += 1;
    b.dayCount += 1;
  }
}
