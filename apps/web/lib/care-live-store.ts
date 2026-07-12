import { randomBytes } from 'node:crypto';

/**
 * Cureocity Care — the single-use start-token store (AC3, §4.2 steps 1-3).
 *
 * POST /care/sessions mints a 32-random-byte hex token; the client redeems
 * it EXACTLY ONCE at POST /care/sessions/[id]/token to receive the live
 * credential. Redis (`REDIS_URL`, EX + GETDEL) is the production store; a
 * module-global in-memory Map with a 60-second sweeper is the dev/CI
 * fallback — same pattern as the codebase's other zero-setup fallbacks.
 *
 * The Redis client is resolved lazily and OPTIONALLY (no hard dependency):
 * if `ioredis` is not installed the store logs once and stays in-memory.
 * Note the in-memory fallback is per-instance — fine for dev, wrong for a
 * multi-instance deployment (set REDIS_URL there).
 */

export interface StartTokenPayload {
  careSessionId: string;
  careUserId: string;
  /** Unix ms — token unusable after this. */
  expiresAtMs: number;
}

interface MemEntry {
  payload: StartTokenPayload;
  expiresAtMs: number;
}

declare global {
  var __careStartTokenStore: Map<string, MemEntry> | undefined;

  var __careStartTokenSweeper: ReturnType<typeof setInterval> | undefined;

  var __careRedisClient: unknown | undefined;

  var __careRedisWarned: boolean | undefined;
}

function memStore(): Map<string, MemEntry> {
  if (!globalThis.__careStartTokenStore) {
    globalThis.__careStartTokenStore = new Map();
  }
  if (!globalThis.__careStartTokenSweeper) {
    globalThis.__careStartTokenSweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of globalThis.__careStartTokenStore ?? []) {
        if (v.expiresAtMs < now) globalThis.__careStartTokenStore?.delete(k);
      }
    }, 60_000);
    // Never keep the process alive just for the sweeper.
    globalThis.__careStartTokenSweeper.unref?.();
  }
  return globalThis.__careStartTokenStore;
}

interface MinimalRedis {
  set(key: string, value: string, ex: 'EX', ttlSec: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

function redis(): MinimalRedis | null {
  const url = process.env['REDIS_URL'];
  if (!url) return null;
  if (globalThis.__careRedisClient) return globalThis.__careRedisClient as MinimalRedis;
  try {
    // Optional dependency — resolved at runtime only, invisible to the
    // bundler. `pnpm add ioredis --filter @cureocity/web` to enable.

    const req = eval('require') as NodeRequire;
    const IORedis = req('ioredis') as new (u: string) => MinimalRedis;
    globalThis.__careRedisClient = new IORedis(url);
    return globalThis.__careRedisClient as MinimalRedis;
  } catch {
    if (!globalThis.__careRedisWarned) {
      globalThis.__careRedisWarned = true;
      console.warn(
        '[care] REDIS_URL is set but ioredis is not installed — start tokens are falling back to the in-memory store (single-instance only).',
      );
    }
    return null;
  }
}

function key(token: string): string {
  return `care:start:${token}`;
}

export function mintStartToken(): string {
  return randomBytes(32).toString('hex');
}

export async function putStartToken(
  token: string,
  payload: StartTokenPayload,
  ttlSec: number,
): Promise<void> {
  const r = redis();
  if (r) {
    await r.set(key(token), JSON.stringify(payload), 'EX', ttlSec);
    return;
  }
  memStore().set(token, { payload, expiresAtMs: Date.now() + ttlSec * 1000 });
}

/** Single-use take (Redis GETDEL semantics). Null = unknown/expired/reused. */
export async function takeStartToken(token: string): Promise<StartTokenPayload | null> {
  const r = redis();
  if (r) {
    const raw = await r.getdel(key(token));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StartTokenPayload;
    } catch {
      return null;
    }
  }
  const entry = memStore().get(token);
  if (!entry) return null;
  memStore().delete(token);
  if (entry.expiresAtMs < Date.now()) return null;
  return entry.payload;
}
