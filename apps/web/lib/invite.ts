import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { InviteCode } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';

/**
 * Sprint 37 — pilot invite-code helpers.
 *
 * Gating is opt-in: PILOT_INVITE_REQUIRED=true makes the auto-provision
 * signup in /api/v1/auth/session require a valid code. Unset/false keeps
 * signup open (dev, demo, and the current pilot until you flip it on).
 */

/** Ambiguity-free alphabet — no 0/O/1/I/L so codes read cleanly aloud. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function isPilotInviteRequired(): boolean {
  return process.env['PILOT_INVITE_REQUIRED'] === 'true';
}

/** Generate a grouped code like "CURE-7K2M-Q9XR". */
export function generateInviteCode(): string {
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `CURE-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export type RedeemResult = { ok: true } | { ok: false; reason: string };

/**
 * Atomically redeem a code inside an existing transaction. The
 * `usedCount < maxUses` guard is a column-to-column comparison Prisma
 * can't express in a `where`, so we use a guarded UPDATE … RETURNING:
 * the row only increments when it's still valid, which is race-safe
 * across concurrent signups of the same multi-use code.
 */
export async function redeemInviteCode(
  tx: Prisma.TransactionClient,
  rawCode: string,
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (code.length === 0) return { ok: false, reason: 'An invite code is required for this pilot.' };

  const rows = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "pilot_invite_codes"
    SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
    WHERE "code" = ${code}
      AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
      AND "usedCount" < "maxUses"
    RETURNING "id"
  `;
  if (rows.length === 1) return { ok: true };

  // Distinguish "no such code" from "exhausted/expired/revoked" for a
  // clearer message — a read is fine here, the UPDATE already failed.
  const existing = await tx.pilotInviteCode.findUnique({ where: { code } });
  if (!existing) return { ok: false, reason: 'That invite code is not valid.' };
  if (existing.revokedAt) return { ok: false, reason: 'That invite code has been revoked.' };
  if (existing.expiresAt && existing.expiresAt <= new Date())
    return { ok: false, reason: 'That invite code has expired.' };
  return { ok: false, reason: 'That invite code has already been fully used.' };
}

interface InviteRow {
  id: string;
  code: string;
  label: string | null;
  maxUses: number;
  usedCount: number;
  createdByPsychologistId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export function toInviteCode(row: InviteRow): InviteCode {
  const active =
    row.revokedAt === null &&
    row.usedCount < row.maxUses &&
    (row.expiresAt === null || row.expiresAt > new Date());
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    createdByPsychologistId: row.createdByPsychologistId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    active,
  };
}

/** Mint a unique code, retrying on the rare unique-collision. */
export async function mintInviteCode(args: {
  label?: string;
  maxUses: number;
  expiresAt: Date | null;
  createdByPsychologistId: string;
}): Promise<InviteRow> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.pilotInviteCode.create({
        data: {
          code: generateInviteCode(),
          label: args.label ?? null,
          maxUses: args.maxUses,
          expiresAt: args.expiresAt,
          createdByPsychologistId: args.createdByPsychologistId,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  throw new Error('Could not generate a unique invite code after several attempts.');
}
