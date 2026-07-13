import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './prisma';

/**
 * Cureocity Care — the single-use live start-token store (AC3, §4.2 steps 1-3).
 *
 * POST /care/sessions mints a 32-random-byte hex token; the client redeems
 * it EXACTLY ONCE at POST /care/sessions/[id]/token to receive the live
 * credential.
 *
 * The store is the CareSession row itself: the token's SHA-256 hash lives
 * in `startTokenHash` (+ absolute `startTokenExpiresAt`). This is correct
 * across every serverless instance with no extra infra — unlike the old
 * per-instance in-memory map, which silently failed on Vercel because the
 * token was minted on one lambda and redeemed on another. The redeem is an
 * atomic conditional `updateMany` (clear-the-hash-if-still-present), so a
 * replayed token loses the race and returns null — true single-use.
 */

export interface StartTokenPayload {
  careSessionId: string;
  careUserId: string;
  /** Unix ms — token unusable after this. */
  expiresAtMs: number;
}

export function mintStartToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Persist the start token (hash only) on its CareSession row. The session
 * row already exists (created immediately before, in the sessions route),
 * and `payload.expiresAtMs` carries the absolute TTL.
 */
export async function putStartToken(token: string, payload: StartTokenPayload): Promise<void> {
  await prisma.careSession.update({
    where: { id: payload.careSessionId },
    data: {
      startTokenHash: hashToken(token),
      startTokenExpiresAt: new Date(payload.expiresAtMs),
    },
  });
}

/**
 * Single-use redeem. Null = unknown / expired / already used. The
 * conditional updateMany guarantees only one caller consumes the token
 * even under a race (both find the row; only one clears it).
 */
export async function takeStartToken(token: string): Promise<StartTokenPayload | null> {
  const hash = hashToken(token);
  const row = await prisma.careSession.findFirst({
    where: { startTokenHash: hash },
    select: { id: true, careUserId: true, startTokenExpiresAt: true },
  });
  if (!row || !row.startTokenExpiresAt) return null;

  const consumed = await prisma.careSession.updateMany({
    where: { id: row.id, startTokenHash: hash },
    data: { startTokenHash: null, startTokenExpiresAt: null },
  });
  if (consumed.count !== 1) return null; // lost the race — already consumed
  if (row.startTokenExpiresAt.getTime() < Date.now()) return null; // expired

  return {
    careSessionId: row.id,
    careUserId: row.careUserId,
    expiresAtMs: row.startTokenExpiresAt.getTime(),
  };
}
