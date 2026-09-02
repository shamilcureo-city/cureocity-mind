export function selectAuthoritativeTodayHero<T extends { id: string }>(
  activeSession: T | null,
  nextFutureSession: T | null,
  dayRows: readonly T[],
): { hero: T | null; remainingDayRows: T[] } {
  const hero = activeSession ?? nextFutureSession;
  return {
    hero,
    remainingDayRows: hero ? dayRows.filter((row) => row.id !== hero.id) : [...dayRows],
  };
}
