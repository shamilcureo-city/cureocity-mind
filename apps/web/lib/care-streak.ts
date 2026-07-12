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
