import { prisma } from '@/lib/prisma';

/**
 * MK6 — privacy-light funnel counters. One row per (therapist, kind,
 * IST day), incremented in place; no visitor identity, no cookies, no
 * third-party analytics on patient pages. Requests/confirms are NOT
 * counted here — they come straight from the Appointment table.
 */

export type ProfileMetricKind = 'PAGE_VIEW' | 'SLOT_VIEW';

const IST_OFFSET_MS = 5.5 * 60 * 60_000;

/** The IST calendar day (as a UTC-midnight Date, for the @db.Date column). */
export function istDay(at: Date): Date {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

/** Fire-and-forget increment — a metrics failure must never break a page. */
export async function recordProfileMetric(
  psychologistId: string,
  kind: ProfileMetricKind,
): Promise<void> {
  try {
    const day = istDay(new Date());
    await prisma.profileMetricDaily.upsert({
      where: { psychologistId_kind_day: { psychologistId, kind, day } },
      create: { psychologistId, kind, day, count: 1 },
      update: { count: { increment: 1 } },
    });
  } catch (e) {
    console.warn(`[profile-metrics] increment failed: ${(e as Error).message}`);
  }
}
