import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ApiError } from './errors.js';
import type { LibraryItem, ProviderId } from './types.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string; // saltHex:scryptHex
  createdAt: string;
}

export interface UsageDayStats {
  date: string; // YYYY-MM-DD UTC
  totalRequests: number;
  paidRequests: number;
  estimatedCostUsd: number;
  byProvider: Record<
    string,
    {
      match: number;
      no_match: number;
      error: number;
      costUsd: number;
      avgLatencyMs: number;
    }
  >;
}

interface PersistedState {
  version: 1;
  users: Record<string, UserRecord>;
  libraries: Record<string, Record<string, LibraryItem>>; // userId -> itemId -> LibraryItem
  usage: Record<string, UsageDayStats>; // YYYY-MM-DD -> stats
}

/**
 * Atomic, versioned JSON persistence store for accounts, synchronized recognition libraries (metadata only — never raw audio),
 * and provider usage/cost metrics.
 */
export class AuralisStore {
  private state: PersistedState = {
    version: 1,
    users: {},
    libraries: {},
    usage: {},
  };
  private readonly filePath: string | null;

  constructor(
    dataDir: string | null,
    private readonly sessionSecret: string,
  ) {
    this.filePath = dataDir ? join(dataDir, 'auralis-db.json') : null;
    this.load();
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (raw && raw.version === 1) {
        this.state = {
          version: 1,
          users: raw.users ?? {},
          libraries: raw.libraries ?? {},
          usage: raw.usage ?? {},
        };
      }
    } catch {
      // Keep clean state if file is unreadable
    }
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.filePath);
  }

  registerUser(emailRaw: string, password: string): { token: string; user: { id: string; email: string } } {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ApiError('BAD_REQUEST', 'Please provide a valid email address.');
    }
    if (typeof password !== 'string' || password.length < 8) {
      throw new ApiError('BAD_REQUEST', 'Password must be at least 8 characters.');
    }
    const existing = Object.values(this.state.users).find((u) => u.email === email);
    if (existing) {
      throw new ApiError('CONFLICT', 'An account with this email already exists.');
    }
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(password, salt, 64).toString('hex');
    const id = randomUUID();
    const user: UserRecord = {
      id,
      email,
      passwordHash: `${salt}:${derived}`,
      createdAt: new Date().toISOString(),
    };
    this.state.users[id] = user;
    this.state.libraries[id] = {};
    this.save();
    return { token: this.issueToken(user.id), user: { id: user.id, email: user.email } };
  }

  loginUser(emailRaw: string, password: string): { token: string; user: { id: string; email: string } } {
    const email = String(emailRaw ?? '').trim().toLowerCase();
    const user = Object.values(this.state.users).find((u) => u.email === email);
    if (!user || typeof password !== 'string') {
      throw new ApiError('UNAUTHORIZED', 'Invalid email or password.');
    }
    const [salt, hashHex] = user.passwordHash.split(':');
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      throw new ApiError('UNAUTHORIZED', 'Invalid email or password.');
    }
    return { token: this.issueToken(user.id), user: { id: user.id, email: user.email } };
  }

  issueToken(userId: string, ttlSec = 30 * 86400): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload = Buffer.from(JSON.stringify({ sub: userId, exp }), 'utf8').toString('base64url');
    const sig = createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  verifyToken(token: string | undefined | null): { id: string; email: string } | null {
    if (!token) return null;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expectedSig = createHmac('sha256', this.sessionSecret).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expectedSig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (!data.sub || typeof data.exp !== 'number' || data.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }
      const user = this.state.users[data.sub];
      return user ? { id: user.id, email: user.email } : null;
    } catch {
      return null;
    }
  }

  getLibrary(userId: string, sinceIso?: string): { items: LibraryItem[]; serverTime: string } {
    const lib = this.state.libraries[userId] ?? {};
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    const items = Object.values(lib)
      .filter((item) => {
        if (sinceMs && Number.isFinite(sinceMs)) {
          return Date.parse(item.updatedAt) >= sinceMs;
        }
        return !item.deleted;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { items, serverTime: new Date().toISOString() };
  }

  syncLibrary(userId: string, incoming: LibraryItem[]): { items: LibraryItem[]; serverTime: string } {
    if (!this.state.libraries[userId]) this.state.libraries[userId] = {};
    const lib = this.state.libraries[userId];

    for (const item of incoming ?? []) {
      if (!item || typeof item.id !== 'string' || !item.track || typeof item.track.title !== 'string') continue;
      // Strip any unexpected fields so raw audio can never be stored in library records.
      const clean: LibraryItem = {
        id: item.id.slice(0, 64),
        track: item.track,
        favorite: Boolean(item.favorite),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: item.updatedAt || new Date().toISOString(),
        ...(item.deleted ? { deleted: true } : {}),
      };
      const current = lib[clean.id];
      if (!current || Date.parse(clean.updatedAt) >= Date.parse(current.updatedAt)) {
        lib[clean.id] = clean;
      }
    }
    this.save();
    return this.getLibrary(userId);
  }

  clearLibrary(userId: string): void {
    this.state.libraries[userId] = {};
    this.save();
  }

  deleteAccount(userId: string): void {
    delete this.state.users[userId];
    delete this.state.libraries[userId];
    this.save();
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  recordProviderUsage(
    providerId: ProviderId,
    status: 'match' | 'no_match' | 'error',
    costUsd: number,
    latencyMs: number,
  ): void {
    const key = this.todayKey();
    if (!this.state.usage[key]) {
      this.state.usage[key] = {
        date: key,
        totalRequests: 0,
        paidRequests: 0,
        estimatedCostUsd: 0,
        byProvider: {},
      };
    }
    const day = this.state.usage[key];
    day.totalRequests += 1;
    if (costUsd > 0 && status !== 'error') {
      day.paidRequests += 1;
      day.estimatedCostUsd = Math.round((day.estimatedCostUsd + costUsd) * 10000) / 10000;
    }
    if (!day.byProvider[providerId]) {
      day.byProvider[providerId] = { match: 0, no_match: 0, error: 0, costUsd: 0, avgLatencyMs: 0 };
    }
    const p = day.byProvider[providerId];
    const prevCount = p.match + p.no_match + p.error;
    p[status] += 1;
    p.costUsd = Math.round((p.costUsd + (status !== 'error' ? costUsd : 0)) * 10000) / 10000;
    p.avgLatencyMs = Math.round((p.avgLatencyMs * prevCount + latencyMs) / (prevCount + 1));
    this.save();
  }

  getTodayPaidRequests(): number {
    return this.state.usage[this.todayKey()]?.paidRequests ?? 0;
  }

  getUsageStats(): UsageDayStats {
    const key = this.todayKey();
    return (
      this.state.usage[key] ?? {
        date: key,
        totalRequests: 0,
        paidRequests: 0,
        estimatedCostUsd: 0,
        byProvider: {},
      }
    );
  }
}
