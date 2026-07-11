/**
 * NEXT4 — per-tenant daily spend ledger.
 *
 * The per-consult cost ceiling (live-session guards) bounds one runaway
 * consult; this bounds a runaway DAY — a clinic looping consults (or a
 * leaked token being replayed) can otherwise spend without limit. The
 * ledger is in-memory and per-instance, which is honest for the current
 * topology (min-instances 1, single region); it is a circuit breaker,
 * not an accounting system — the durable record stays in
 * LiveConsultMetric / GeminiCallLog.
 *
 * Day boundary is IST (UTC+5:30, no DST) to match the product's clinic
 * day everywhere else (clinic queue tokens, dashboards).
 */

const IST_OFFSET_MIN = 5 * 60 + 30;

/** YYYY-MM-DD in IST. */
export function istDayKey(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return ist.toISOString().slice(0, 10);
}

interface TenantDay {
  day: string;
  inr: number;
}

export class TenantSpendLedger {
  private readonly byTenant = new Map<string, TenantDay>();

  constructor(private readonly capInr: number) {}

  /** Cap disabled (unset / zero / negative) → never refuses. */
  get enabled(): boolean {
    return this.capInr > 0;
  }

  /** Today's accumulated spend for the tenant (0 after a day rollover). */
  spentToday(psychologistId: string, now: Date = new Date()): number {
    const entry = this.byTenant.get(psychologistId);
    if (!entry || entry.day !== istDayKey(now)) return 0;
    return entry.inr;
  }

  /** True when the tenant is at/over the daily cap and must be refused. */
  isOverCap(psychologistId: string, now: Date = new Date()): boolean {
    if (!this.enabled) return false;
    return this.spentToday(psychologistId, now) >= this.capInr;
  }

  /** Accumulate a spend delta (negative/NaN deltas are ignored). */
  add(psychologistId: string, deltaInr: number, now: Date = new Date()): void {
    if (!Number.isFinite(deltaInr) || deltaInr <= 0) return;
    const day = istDayKey(now);
    const entry = this.byTenant.get(psychologistId);
    if (!entry || entry.day !== day) {
      this.byTenant.set(psychologistId, { day, inr: deltaInr });
      // Opportunistic sweep: drop stale tenants so the map can't grow
      // unbounded across days on a long-lived instance.
      for (const [id, e] of this.byTenant) {
        if (e.day !== day) this.byTenant.delete(id);
      }
      return;
    }
    entry.inr += deltaInr;
  }
}

/** Ledger configured from the environment (LIVE_GATEWAY_TENANT_DAILY_INR_CAP). */
export function ledgerFromEnv(): TenantSpendLedger {
  return new TenantSpendLedger(Number(process.env['LIVE_GATEWAY_TENANT_DAILY_INR_CAP'] ?? 2000));
}
