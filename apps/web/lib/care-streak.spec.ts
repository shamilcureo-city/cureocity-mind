import { describe, expect, it } from 'vitest';
import { computeCareStreak, istDayKey } from './care-streak';

// 2026-07-10T18:30:00Z == 2026-07-11 00:00 IST — the tricky boundary.
const NOW = new Date('2026-07-10T20:00:00Z'); // 2026-07-11 01:30 IST

function istDaysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe('computeCareStreak (IST day boundaries)', () => {
  it('returns 0 with no activity', () => {
    expect(computeCareStreak([], NOW)).toBe(0);
  });

  it('counts consecutive IST days back from today', () => {
    expect(computeCareStreak([istDaysAgo(0), istDaysAgo(1), istDaysAgo(2)], NOW)).toBe(3);
  });

  it('survives an inactive today by counting from yesterday', () => {
    expect(computeCareStreak([istDaysAgo(1), istDaysAgo(2)], NOW)).toBe(2);
  });

  it('breaks on a gap', () => {
    expect(computeCareStreak([istDaysAgo(0), istDaysAgo(2), istDaysAgo(3)], NOW)).toBe(1);
  });

  it('uses IST, not UTC, for the day key', () => {
    // 20:00 UTC = 01:30 IST next day.
    expect(istDayKey(new Date('2026-07-10T20:00:00Z'))).toBe('2026-07-11');
    expect(istDayKey(new Date('2026-07-10T12:00:00Z'))).toBe('2026-07-10');
  });
});
