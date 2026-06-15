import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Sprint 56 (Lever 3b) — referral program.
 *
 * Referred therapist gets REFERRED_FREE_DAYS of Pro immediately on
 * signup with a valid code. The referrer gets REFERRER_REWARD_DAYS, but
 * only when the referred CONVERTS (first PAID payment) — gated by
 * ReferralRedemption.rewardGrantedAt so a wave of fake signups can't
 * mint free months.
 */
export const REFERRED_FREE_DAYS = Number(process.env['REFERRAL_REFERRED_FREE_DAYS'] ?? 31);
export const REFERRER_REWARD_DAYS = Number(process.env['REFERRAL_REFERRER_REWARD_DAYS'] ?? 62);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Unambiguous alphabet (no O/0/I/1) for a hand-typeable 8-char code. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** Get-or-create the caller's referral code. */
export async function ensureReferralCode(psychologistId: string): Promise<string> {
  const existing = await prisma.referralCode.findUnique({
    where: { psychologistId },
    select: { code: true },
  });
  if (existing) return existing.code;
  // Retry on the rare code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await prisma.referralCode.create({
        data: { psychologistId, code: generateCode() },
        select: { code: true },
      });
      return row.code;
    } catch {
      // unique violation on code — try again; on psychologistId race,
      // re-read below.
      const reread = await prisma.referralCode.findUnique({
        where: { psychologistId },
        select: { code: true },
      });
      if (reread) return reread.code;
    }
  }
  throw new Error('Could not allocate a referral code');
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Redeem a referral code for a brand-new signup, inside the signup tx.
 * Grants the referred therapist a free Pro month and records the
 * redemption. No-op (returns false) if the code is unknown, self-
 * referral, or the referred user is already referred. Never throws on a
 * bad code — a referral mishap must not roll back a signup.
 */
export async function redeemReferralAtSignup(
  tx: Tx,
  args: { code: string; referredPsychologistId: string; billingAccountId: string; now: Date },
): Promise<{ referrerPsychologistId: string } | null> {
  const code = args.code.trim().toUpperCase();
  if (!code) return null;
  const referral = await tx.referralCode.findUnique({ where: { code } });
  if (!referral) return null;
  if (referral.psychologistId === args.referredPsychologistId) return null; // self-referral

  const already = await tx.referralRedemption.findUnique({
    where: { referredPsychologistId: args.referredPsychologistId },
    select: { id: true },
  });
  if (already) return null;

  await tx.referralRedemption.create({
    data: {
      code,
      referrerPsychologistId: referral.psychologistId,
      referredPsychologistId: args.referredPsychologistId,
    },
  });
  // Referred reward: a free Pro month from now.
  await tx.billingAccount.update({
    where: { id: args.billingAccountId },
    data: {
      plan: 'PRO_MONTHLY',
      status: 'ACTIVE',
      paidThroughAt: new Date(args.now.getTime() + REFERRED_FREE_DAYS * DAY_MS),
    },
  });
  return { referrerPsychologistId: referral.psychologistId };
}

/**
 * On a referred therapist's first PAID payment, grant the referrer their
 * reward (extend paidThroughAt) exactly once. Inside the webhook tx.
 * Returns the referrer id if a reward was granted, else null.
 */
export async function grantReferrerRewardOnConversion(
  tx: Tx,
  args: { referredPsychologistId: string; now: Date },
): Promise<{ referrerPsychologistId: string; newPaidThroughAt: Date } | null> {
  const redemption = await tx.referralRedemption.findUnique({
    where: { referredPsychologistId: args.referredPsychologistId },
  });
  if (!redemption || redemption.rewardGrantedAt !== null) return null;

  // Ensure the referrer has an account, then extend from max(now, current).
  const referrerAccount =
    (await tx.billingAccount.findUnique({
      where: { psychologistId: redemption.referrerPsychologistId },
    })) ??
    (await tx.billingAccount.create({
      data: { psychologistId: redemption.referrerPsychologistId },
    }));
  const base =
    referrerAccount.paidThroughAt && referrerAccount.paidThroughAt > args.now
      ? referrerAccount.paidThroughAt
      : args.now;
  const newPaidThroughAt = new Date(base.getTime() + REFERRER_REWARD_DAYS * DAY_MS);

  await tx.billingAccount.update({
    where: { id: referrerAccount.id },
    data: {
      // A referrer on FREE_TRIAL gets bumped to Pro for the reward window.
      plan: referrerAccount.plan === 'FREE_TRIAL' ? 'PRO_MONTHLY' : referrerAccount.plan,
      status: 'ACTIVE',
      paidThroughAt: newPaidThroughAt,
    },
  });
  await tx.referralRedemption.update({
    where: { id: redemption.id },
    data: { rewardGrantedAt: args.now },
  });
  return { referrerPsychologistId: redemption.referrerPsychologistId, newPaidThroughAt };
}
