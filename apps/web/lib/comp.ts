import { type BillingPlan } from '@prisma/client';
import { writeAudit } from './audit';
import { prisma } from './prisma';

/**
 * Sprint 56 ops — comp an account onto a paid tier without going through
 * Razorpay. Used by:
 *   - scripts/comp-account.ts (laptop CLI, for emergencies)
 *   - POST /api/v1/admin/comp (in-product, the main path)
 *
 * The function is idempotent: a re-run with the same args just refreshes
 * paidThroughAt and writes another audit row (one per operator action;
 * each is a legitimate record of "I gave them a comp on day X"). The
 * audit metadata carries `comp:true` so the funnel dashboard's MRR can
 * exclude comped accounts from "real paid revenue".
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TIERS = ['PRO', 'PREMIUM', 'STARTER', 'TRAINEE'] as const;
export type CompTier = (typeof TIERS)[number];

const TIER_TO_PLAN: Record<CompTier, BillingPlan> = {
  PRO: 'PRO_MONTHLY',
  PREMIUM: 'PREMIUM_MONTHLY',
  STARTER: 'STARTER_MONTHLY',
  TRAINEE: 'TRAINEE_MONTHLY',
};

export interface CompArgs {
  /** E.164, e.g. "+917025840227". Matched against Psychologist.phone (unique). */
  phone: string;
  tier: CompTier;
  /** Months of comped access. paidThroughAt becomes now + months × 30d. */
  months: number;
  /** Email / identifier of the human running the comp; lands in audit metadata. */
  operator: string;
  /** Free-text reason; lands in audit metadata. */
  reason: string;
}

export interface CompBefore {
  plan: BillingPlan;
  status: string;
  paidThroughAt: string | null;
}

export interface CompResult {
  psychologistId: string;
  fullName: string;
  email: string;
  phone: string;
  before: CompBefore | null;
  after: { plan: BillingPlan; status: 'ACTIVE'; paidThroughAt: string };
}

export class CompError extends Error {
  constructor(
    public code: 'PSY_NOT_FOUND' | 'PSY_DELETED' | 'BAD_TIER',
    message: string,
  ) {
    super(message);
  }
}

export function isCompTier(s: string): s is CompTier {
  return (TIERS as readonly string[]).includes(s);
}

export async function compAccount(args: CompArgs): Promise<CompResult> {
  if (!isCompTier(args.tier)) {
    throw new CompError('BAD_TIER', `Unknown tier ${args.tier}; expected one of ${TIERS.join('|')}`);
  }
  const psy = await prisma.psychologist.findUnique({
    where: { phone: args.phone },
    select: { id: true, fullName: true, email: true, phone: true, deletedAt: true },
  });
  if (!psy) {
    throw new CompError('PSY_NOT_FOUND', `No Psychologist with phone="${args.phone}".`);
  }
  if (psy.deletedAt !== null) {
    throw new CompError('PSY_DELETED', `Psychologist ${psy.id} is soft-deleted.`);
  }

  const existing = await prisma.billingAccount.findUnique({
    where: { psychologistId: psy.id },
    select: { plan: true, status: true, paidThroughAt: true },
  });
  const before: CompBefore | null = existing
    ? {
        plan: existing.plan,
        status: existing.status,
        paidThroughAt: existing.paidThroughAt?.toISOString() ?? null,
      }
    : null;

  const newPlan = TIER_TO_PLAN[args.tier];
  const newPaidThroughAt = new Date(Date.now() + args.months * 30 * MS_PER_DAY);

  await prisma.$transaction(async (tx) => {
    const account = await tx.billingAccount.upsert({
      where: { psychologistId: psy.id },
      create: {
        psychologistId: psy.id,
        plan: newPlan,
        status: 'ACTIVE',
        paidThroughAt: newPaidThroughAt,
      },
      update: {
        plan: newPlan,
        status: 'ACTIVE',
        paidThroughAt: newPaidThroughAt,
        pausedRemainingDays: null,
        canceledAt: null,
      },
      select: { id: true },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        actorPsychologistId: psy.id,
        action: 'PLAN_UPGRADED',
        targetType: 'BillingAccount',
        targetId: account.id,
        metadata: {
          source: 'manual_comp',
          operator: args.operator,
          reason: args.reason,
          tier: args.tier,
          plan: newPlan,
          monthsGranted: args.months,
          paidThroughAt: newPaidThroughAt.toISOString(),
          comp: true,
          previousPlan: existing?.plan ?? null,
          previousPaidThroughAt: existing?.paidThroughAt?.toISOString() ?? null,
        },
      },
      tx,
    );
  });

  return {
    psychologistId: psy.id,
    fullName: psy.fullName,
    email: psy.email,
    phone: psy.phone,
    before,
    after: { plan: newPlan, status: 'ACTIVE', paidThroughAt: newPaidThroughAt.toISOString() },
  };
}
