import { describe, expect, it } from 'vitest';
import { computeCareWeeks } from './care-streak';

/**
 * CG4 — the showing-up record invariants (docs/CARE_GROWTH_SYSTEM.md §6):
 * counts up, auto-bridges thin weeks, never zeroes the lifetime floor.
 */

// Monday 2026-08-24 00:00 IST == 2026-08-23T18:30:00Z.
const NOW = new Date('2026-08-26T12:00:00Z'); // Wednesday of that week
const day = (offset: number): Date => new Date(NOW.getTime() + offset * 24 * 60 * 60 * 1000);

describe('computeCareWeeks', () => {
  it('is zero with no history', () => {
    expect(computeCareWeeks({ sessionDates: [], checkinDates: [], now: NOW })).toEqual({
      weeks: 0,
      totalSessions: 0,
      totalCheckins: 0,
    });
  });

  it('one session this week starts the record at week 1', () => {
    const r = computeCareWeeks({ sessionDates: [day(-1)], checkinDates: [], now: NOW });
    expect(r.weeks).toBe(1);
    expect(r.totalSessions).toBe(1);
  });

  it('counts consecutive session weeks', () => {
    const r = computeCareWeeks({
      sessionDates: [day(-1), day(-8), day(-15)],
      checkinDates: [],
      now: NOW,
    });
    expect(r.weeks).toBe(3);
  });

  it('a week qualifies on 4 check-in days without a session', () => {
    // Thu/Wed/Tue/Mon of LAST week (weeks run Mon–Sun in IST).
    const r = computeCareWeeks({
      sessionDates: [],
      checkinDates: [day(-6), day(-7), day(-8), day(-9)],
      now: NOW,
    });
    // Last week qualifies; this week is empty but forgiving.
    expect(r.weeks).toBe(1);
  });

  it('bridges a thin week between qualifying weeks — life happens', () => {
    const r = computeCareWeeks({
      sessionDates: [day(-1), day(-15)],
      checkinDates: [day(-8)], // thin week in the middle: 1 check-in, no session
      now: NOW,
    });
    expect(r.weeks).toBe(3);
  });

  it('does not bridge more than 2 thin weeks in a row', () => {
    const r = computeCareWeeks({
      sessionDates: [day(-1), day(-29)],
      checkinDates: [day(-8), day(-15), day(-22)], // three thin weeks
      now: NOW,
    });
    // current(1) + two bridges, then the chain breaks before day(-29)'s week.
    expect(r.weeks).toBe(3);
  });

  it('a record of ONLY thin weeks is not a record yet', () => {
    const r = computeCareWeeks({ sessionDates: [], checkinDates: [day(-1)], now: NOW });
    expect(r.weeks).toBe(0);
    expect(r.totalCheckins).toBe(1); // the lifetime floor still counts up
  });

  it('an empty current week is forgiving — counting starts last week', () => {
    const r = computeCareWeeks({
      sessionDates: [day(-8), day(-15)],
      checkinDates: [],
      now: NOW,
    });
    expect(r.weeks).toBe(2);
  });

  it('a long gap ends the weekly spine but never the lifetime totals', () => {
    const r = computeCareWeeks({
      sessionDates: [day(-1), day(-60)],
      checkinDates: [],
      now: NOW,
    });
    expect(r.weeks).toBe(1);
    expect(r.totalSessions).toBe(2);
  });
});
