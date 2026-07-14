/**
 * Cureocity Care — daily-streak computation (AC2). Pure. A "day counts"
 * if it has a mood check-in OR a completed session, in IST (the product's
 * users live in one timezone; a UTC boundary would break evening streaks).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Consecutive IST days with activity, counting back from today (a streak
 * survives if today has no activity YET — it counts from yesterday then).
 */
export function computeCareStreak(activityDates: Date[], now: Date = new Date()): number {
  if (activityDates.length === 0) return 0;
  const days = new Set(activityDates.map(istDayKey));
  const todayKey = istDayKey(now);
  let cursor = new Date(now.getTime());
  // If today is inactive, start from yesterday without breaking the streak.
  if (!days.has(todayKey)) cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  let streak = 0;
  while (days.has(istDayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
  }
  return streak;
}

// ============================================================================
// CG4 — the showing-up record (streak v2, docs/CARE_GROWTH_SYSTEM.md §6).
// The daily 🔥 is retired from home: it is structurally breakable on a
// 2/week free tier, and for a shame-prone population a broken streak is
// evidence for the negative self-schema (abstinence-violation effect). The
// record counts UP in two layers and cannot be zeroed:
//   - weekly spine: a week counts with ≥1 session OR ≥4 check-in days; a
//     THIN week (1–3 check-in days, no session) auto-bridges — up to 2 in a
//     row — granted automatically, never purchasable.
//   - lifetime floor: total sessions + total check-ins, un-zeroable by
//     construction.
// ============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CareWeeksInput {
  /** Completed-session dates (endedAt). */
  sessionDates: Date[];
  /** Check-in dates. */
  checkinDates: Date[];
  now?: Date;
}

export interface CareWeeksRecord {
  /** Consecutive "showing up" weeks ending at the current week. */
  weeks: number;
  totalSessions: number;
  totalCheckins: number;
}

/** IST week key — weeks start Monday. Returns the Monday's day index. */
function istWeekIndex(d: Date): number {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const dayIndex = Math.floor(shifted.getTime() / DAY_MS);
  const dow = (shifted.getUTCDay() + 6) % 7; // 0 = Monday
  return dayIndex - dow;
}

export function computeCareWeeks(input: CareWeeksInput): CareWeeksRecord {
  const now = input.now ?? new Date();
  const totalSessions = input.sessionDates.length;
  const totalCheckins = input.checkinDates.length;
  if (totalSessions === 0 && totalCheckins === 0) {
    return { weeks: 0, totalSessions, totalCheckins };
  }

  const sessionsByWeek = new Map<number, number>();
  for (const d of input.sessionDates) {
    const w = istWeekIndex(d);
    sessionsByWeek.set(w, (sessionsByWeek.get(w) ?? 0) + 1);
  }
  const checkinDaysByWeek = new Map<number, Set<string>>();
  for (const d of input.checkinDates) {
    const w = istWeekIndex(d);
    const set = checkinDaysByWeek.get(w) ?? new Set<string>();
    set.add(istDayKey(d));
    checkinDaysByWeek.set(w, set);
  }

  const qualifies = (w: number): boolean =>
    (sessionsByWeek.get(w) ?? 0) >= 1 || (checkinDaysByWeek.get(w)?.size ?? 0) >= 4;
  const isThin = (w: number): boolean =>
    (sessionsByWeek.get(w) ?? 0) === 0 && (checkinDaysByWeek.get(w)?.size ?? 0) >= 1;

  const currentWeek = istWeekIndex(now);
  // The current (partial) week is forgiving, like the daily streak's today:
  // if it doesn't qualify yet, counting starts from last week.
  let cursor = currentWeek;
  if (!qualifies(cursor) && !isThin(cursor)) cursor -= 7;

  let weeks = 0;
  let bridged = 0;
  for (;;) {
    if (qualifies(cursor)) {
      weeks += 1;
      bridged = 0;
    } else if (isThin(cursor) && bridged < 2) {
      // "Life happens" week — still counts, up to 2 in a row.
      weeks += 1;
      bridged += 1;
    } else {
      break;
    }
    cursor -= 7;
    if (cursor < currentWeek - 7 * 530) break; // ~10y backstop
  }
  // A record built ONLY of bridged thin weeks isn't a record yet.
  if (weeks > 0 && weeks === bridged) weeks = 0;
  return { weeks, totalSessions, totalCheckins };
}
