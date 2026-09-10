import { computeDayBoundaries } from './ist';

/** A start date is useful context, never proof that the microphone is active. */
export function selectAuthoritativeTodayHero<
  T extends { id: string; startedAt?: Date | string | null },
>(
  activeSession: T | null,
  nextFutureSession: T | null,
  dayRows: readonly T[],
  now: Date = new Date(),
): { hero: T | null; remainingDayRows: T[] } {
  const started = activeSession?.startedAt ? new Date(activeSession.startedAt).getTime() : NaN;
  const startedToday =
    started >= computeDayBoundaries(now).startOfToday.getTime() && started <= now.getTime();
  const hero = startedToday ? activeSession : nextFutureSession;
  return {
    hero,
    remainingDayRows: hero ? dayRows.filter((row) => row.id !== hero.id) : [...dayRows],
  };
}
