/**
 * Shared IST (Asia/Kolkata, UTC+5:30, no DST) date helpers.
 *
 * Cureocity is an India-only product, but Vercel's server clock is UTC.
 * Any "what day is it" / "morning vs evening" logic must be computed in
 * IST or it cuts the day at the wrong moment for an Indian therapist.
 *
 * Extracted from `apps/web/app/app/today/page.tsx` (Sprint 45) so the
 * Today screen and the Dashboard (Sprint 57) share one implementation.
 */

const IST_OFFSET_MIN = 5 * 60 + 30;
const IST_TZ = 'Asia/Kolkata';

export interface DayBoundaries {
  startOfToday: Date;
  endOfToday: Date;
  startOfTomorrow: Date;
  /** End of the 3-day look-ahead window (exclusive). */
  lookAheadEnd: Date;
}

/**
 * Today's start/end in IST, returned as UTC `Date` instances so a Prisma
 * `gte`/`lt` filter behaves correctly regardless of the server timezone.
 */
export function computeDayBoundaries(now: Date = new Date()): DayBoundaries {
  // Shift into IST, read the calendar parts, reshift back to UTC.
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const istY = ist.getUTCFullYear();
  const istM = ist.getUTCMonth();
  const istD = ist.getUTCDate();
  const startOfToday = new Date(Date.UTC(istY, istM, istD) - IST_OFFSET_MIN * 60_000);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfTomorrow = endOfToday;
  const lookAheadEnd = new Date(startOfTomorrow.getTime() + 3 * 24 * 60 * 60 * 1000);
  return { startOfToday, endOfToday, startOfTomorrow, lookAheadEnd };
}

/** "Good morning" / "Good afternoon" / "Good evening" by IST hour. */
export function istGreeting(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const hour = ist.getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatDayHeader(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: IST_TZ,
  });
}

export function formatDayShort(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: IST_TZ,
  });
}

export function formatIstTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: IST_TZ,
  });
}

// ---------------------------------------------------------------------------
// UI truth pass (2026-07 audit) — the ONE date format for therapist-facing
// surfaces. The audit found the same session date rendered three ways on one
// page ("12/7/2026, 10:00:00 am", "7/12/2026, 11:00:00 AM", "12 Jul 2026,
// 10:00 am") — and D/M vs M/D ambiguity is a clinical-safety problem, not a
// style nit. "12 Jul 2026" is unambiguous in either reading order. Seconds
// are never shown. Always IST (India-only product; server clock is UTC).
// ---------------------------------------------------------------------------

/** "12 Jul 2026" — unambiguous, no locale-order trap. */
export function formatIstDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: IST_TZ,
  });
}

/** "12 Jul 2026, 10:00 am" — the canonical date-time everywhere in-app. */
export function formatIstDateTime(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return `${formatIstDate(d)}, ${formatIstTime(d)}`;
}
