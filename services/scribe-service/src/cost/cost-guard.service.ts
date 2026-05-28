import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

/**
 * Per-session and per-therapist cost gating (gap G6).
 * Caps default to ₹500/session and ₹15 000/therapist/month per the plan;
 * both are configurable via env so we can tune mid-pilot without redeploying.
 *
 * Estimation: pre-check sums actual successful GeminiCallLog rows + the
 * caller's estimated cost for the upcoming call. Conservative because Gemini
 * pricing rarely under-charges, but a buffer can be set by lowering the cap.
 */
@Injectable()
export class CostGuardService {
  private readonly logger = new Logger(CostGuardService.name);
  private readonly sessionCapInr: number;
  private readonly monthlyCapInr: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.sessionCapInr = Number(config.get('COST_CAP_PER_SESSION_INR') ?? 500);
    this.monthlyCapInr = Number(config.get('COST_CAP_PER_THERAPIST_MONTHLY_INR') ?? 15_000);
  }

  async getSessionTotalInr(sessionId: string): Promise<Prisma.Decimal> {
    const agg = await this.prisma.geminiCallLog.aggregate({
      where: { sessionId, status: 'SUCCESS' },
      _sum: { costInr: true },
    });
    return agg._sum.costInr ?? new Prisma.Decimal(0);
  }

  async getTherapistMonthlyTotalInr(
    psychologistId: string,
    asOf: Date = new Date(),
  ): Promise<Prisma.Decimal> {
    const startOfMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1));
    const startOfNextMonth = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + 1, 1));

    const agg = await this.prisma.geminiCallLog.aggregate({
      where: {
        createdAt: { gte: startOfMonth, lt: startOfNextMonth },
        status: 'SUCCESS',
        session: { psychologistId },
      },
      _sum: { costInr: true },
    });
    return agg._sum.costInr ?? new Prisma.Decimal(0);
  }

  /**
   * Throws CostCircuitOpenError if running session total + estimated next
   * call cost would exceed the session cap, OR if monthly therapist total
   * + estimated cost would exceed the monthly cap.
   */
  async checkBeforeCall(opts: {
    sessionId: string;
    psychologistId: string;
    estimatedCostInr: number;
  }): Promise<void> {
    const estimated = new Prisma.Decimal(opts.estimatedCostInr);

    const [sessionTotal, monthlyTotal] = await Promise.all([
      this.getSessionTotalInr(opts.sessionId),
      this.getTherapistMonthlyTotalInr(opts.psychologistId),
    ]);

    const projectedSession = sessionTotal.plus(estimated);
    if (projectedSession.gt(this.sessionCapInr)) {
      throw new CostCircuitOpenError(
        `Session cost cap ₹${this.sessionCapInr} would be exceeded (current ₹${sessionTotal.toFixed(4)}, projected ₹${projectedSession.toFixed(4)})`,
        {
          scope: 'session',
          sessionId: opts.sessionId,
          currentInr: sessionTotal.toNumber(),
          projectedInr: projectedSession.toNumber(),
          capInr: this.sessionCapInr,
        },
      );
    }

    const projectedMonthly = monthlyTotal.plus(estimated);
    if (projectedMonthly.gt(this.monthlyCapInr)) {
      throw new CostCircuitOpenError(
        `Therapist monthly cost cap ₹${this.monthlyCapInr} would be exceeded (current ₹${monthlyTotal.toFixed(4)}, projected ₹${projectedMonthly.toFixed(4)})`,
        {
          scope: 'monthly',
          psychologistId: opts.psychologistId,
          currentInr: monthlyTotal.toNumber(),
          projectedInr: projectedMonthly.toNumber(),
          capInr: this.monthlyCapInr,
        },
      );
    }
  }
}
