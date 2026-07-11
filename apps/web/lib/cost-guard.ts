import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Cost-guard port from scribe-service/src/cost/cost-guard.service.ts.
 * Stateless — every call sums GeminiCallLog rows + compares against
 * env-configurable caps. Defaults match the original (₹500/session,
 * ₹15 000/therapist/month).
 */

export type CostScope = 'session' | 'monthly';

export interface CostCircuitMeta {
  scope: CostScope;
  sessionId?: string;
  psychologistId?: string;
  currentInr: number;
  projectedInr: number;
  capInr: number;
}

export class CostCircuitOpenError extends Error {
  constructor(
    message: string,
    public readonly meta: CostCircuitMeta,
  ) {
    super(message);
    this.name = 'CostCircuitOpenError';
  }
}

function sessionCap(): number {
  return Number(process.env['COST_CAP_PER_SESSION_INR'] ?? 500);
}
function monthlyCap(): number {
  return Number(process.env['COST_CAP_PER_THERAPIST_MONTHLY_INR'] ?? 15_000);
}

export async function getSessionTotalInr(sessionId: string): Promise<Prisma.Decimal> {
  const agg = await prisma.geminiCallLog.aggregate({
    where: { sessionId, status: 'SUCCESS' },
    _sum: { costInr: true },
  });
  return agg._sum.costInr ?? new Prisma.Decimal(0);
}

export async function getTherapistMonthlyTotalInr(
  psychologistId: string,
  asOf: Date = new Date(),
): Promise<Prisma.Decimal> {
  const startOfMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
  const startOfNextMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));
  const agg = await prisma.geminiCallLog.aggregate({
    where: {
      createdAt: { gte: startOfMonth, lt: startOfNextMonth },
      status: 'SUCCESS',
      // AUD1 — session-attributed calls AND session-less tenant calls (the
      // practice-assistant chat logs psychologistId directly).
      OR: [{ session: { psychologistId } }, { psychologistId }],
    },
    _sum: { costInr: true },
  });
  return agg._sum.costInr ?? new Prisma.Decimal(0);
}

/**
 * AUD1 — monthly-only circuit for session-less LLM surfaces (the practice
 * assistant chat). Same monthly cap as {@link checkCostCircuit}, no session leg.
 */
export async function checkMonthlyCostCircuit(opts: {
  psychologistId: string;
  estimatedCostInr: number;
}): Promise<void> {
  const estimated = new Prisma.Decimal(opts.estimatedCostInr);
  const mCap = monthlyCap();
  const monthlyTotal = await getTherapistMonthlyTotalInr(opts.psychologistId);
  const projectedMonthly = monthlyTotal.plus(estimated);
  if (projectedMonthly.gt(mCap)) {
    throw new CostCircuitOpenError(
      `Therapist monthly cost cap ₹${mCap} would be exceeded (current ₹${monthlyTotal.toFixed(4)}, projected ₹${projectedMonthly.toFixed(4)})`,
      {
        scope: 'monthly',
        psychologistId: opts.psychologistId,
        currentInr: monthlyTotal.toNumber(),
        projectedInr: projectedMonthly.toNumber(),
        capInr: mCap,
      },
    );
  }
}

export async function checkCostCircuit(opts: {
  sessionId: string;
  psychologistId: string;
  estimatedCostInr: number;
}): Promise<void> {
  const estimated = new Prisma.Decimal(opts.estimatedCostInr);
  const sCap = sessionCap();
  const mCap = monthlyCap();

  const [sessionTotal, monthlyTotal] = await Promise.all([
    getSessionTotalInr(opts.sessionId),
    getTherapistMonthlyTotalInr(opts.psychologistId),
  ]);

  const projectedSession = sessionTotal.plus(estimated);
  if (projectedSession.gt(sCap)) {
    throw new CostCircuitOpenError(
      `Session cost cap ₹${sCap} would be exceeded (current ₹${sessionTotal.toFixed(4)}, projected ₹${projectedSession.toFixed(4)})`,
      {
        scope: 'session',
        sessionId: opts.sessionId,
        currentInr: sessionTotal.toNumber(),
        projectedInr: projectedSession.toNumber(),
        capInr: sCap,
      },
    );
  }
  const projectedMonthly = monthlyTotal.plus(estimated);
  if (projectedMonthly.gt(mCap)) {
    throw new CostCircuitOpenError(
      `Therapist monthly cost cap ₹${mCap} would be exceeded (current ₹${monthlyTotal.toFixed(4)}, projected ₹${projectedMonthly.toFixed(4)})`,
      {
        scope: 'monthly',
        psychologistId: opts.psychologistId,
        currentInr: monthlyTotal.toNumber(),
        projectedInr: projectedMonthly.toNumber(),
        capInr: mCap,
      },
    );
  }
}
