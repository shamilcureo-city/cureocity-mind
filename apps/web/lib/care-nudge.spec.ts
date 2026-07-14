import { describe, expect, it } from 'vitest';
import {
  CARE_NUDGE_DEFAULT_WINDOW_HOUR,
  decideCareCronNudge,
  type CareCronNudgeInput,
} from './care-nudge';

/**
 * CG4 — the channel-policy invariants (docs/CARE_GROWTH_SYSTEM.md §6/§9).
 * These pin the ethics charter's outbound rules as executable assertions:
 * consent-gated, suppression-gated, quiet-hours, ≤2/week, one-per-day, each
 * ladder rung once per lapse, silence after day 30.
 */

const BASE: CareCronNudgeInput = {
  whatsappOptInAt: new Date('2026-08-01T10:00:00Z'),
  suppress: false,
  istHour: CARE_NUDGE_DEFAULT_WINDOW_HOUR,
  istDow: 2, // Tuesday
  windowStartHour: null,
  sessionDays: [],
  daysSinceLastActivity: 0,
  sentLast7Days: 0,
  sentToday: false,
  ladderSentThisLapse: { d3: false, d7: false, d30: false },
};

describe('decideCareCronNudge', () => {
  it('never sends without the timestamped opt-in', () => {
    expect(
      decideCareCronNudge({ ...BASE, whatsappOptInAt: null, daysSinceLastActivity: 5 }),
    ).toBeNull();
  });

  it('never sends under suppression — nudges during a hold must be exactly 0', () => {
    expect(decideCareCronNudge({ ...BASE, suppress: true, daysSinceLastActivity: 5 })).toBeNull();
  });

  it('sends only in the chosen quiet-hours window', () => {
    expect(decideCareCronNudge({ ...BASE, istHour: 10, daysSinceLastActivity: 4 })).toBeNull();
    expect(
      decideCareCronNudge({
        ...BASE,
        istHour: 20,
        windowStartHour: 20,
        daysSinceLastActivity: 4,
      }),
    ).toEqual({ kind: 'LADDER_D3' });
  });

  it('respects the one-per-day and two-per-week caps', () => {
    expect(decideCareCronNudge({ ...BASE, sentToday: true, daysSinceLastActivity: 4 })).toBeNull();
    expect(decideCareCronNudge({ ...BASE, sentLast7Days: 2, daysSinceLastActivity: 4 })).toBeNull();
  });

  it('sends the session-day reminder only to an active user on a picked day', () => {
    expect(decideCareCronNudge({ ...BASE, sessionDays: [2], daysSinceLastActivity: 1 })).toEqual({
      kind: 'SESSION_DAY',
    });
    // A lapsed user never gets "you pencilled today in" — the ladder's
    // door-open tone owns that lapse.
    expect(decideCareCronNudge({ ...BASE, sessionDays: [2], daysSinceLastActivity: 4 })).toEqual({
      kind: 'LADDER_D3',
    });
  });

  it('walks the ladder by lapse length', () => {
    expect(decideCareCronNudge({ ...BASE, daysSinceLastActivity: 3 })).toEqual({
      kind: 'LADDER_D3',
    });
    expect(decideCareCronNudge({ ...BASE, daysSinceLastActivity: 9 })).toEqual({
      kind: 'LADDER_D7',
    });
    expect(decideCareCronNudge({ ...BASE, daysSinceLastActivity: 30 })).toEqual({
      kind: 'LADDER_D30',
    });
  });

  it('fires each rung at most once per lapse', () => {
    expect(
      decideCareCronNudge({
        ...BASE,
        daysSinceLastActivity: 4,
        ladderSentThisLapse: { d3: true, d7: false, d30: false },
      }),
    ).toBeNull();
    expect(
      decideCareCronNudge({
        ...BASE,
        daysSinceLastActivity: 10,
        ladderSentThisLapse: { d3: true, d7: true, d30: false },
      }),
    ).toBeNull();
  });

  it('goes silent forever after the day-30 message — a promise we keep', () => {
    expect(
      decideCareCronNudge({
        ...BASE,
        daysSinceLastActivity: 90,
        ladderSentThisLapse: { d3: true, d7: true, d30: true },
      }),
    ).toBeNull();
  });

  it('sends nothing to a user active today or yesterday', () => {
    expect(decideCareCronNudge({ ...BASE, daysSinceLastActivity: 0 })).toBeNull();
    expect(decideCareCronNudge({ ...BASE, daysSinceLastActivity: 1 })).toBeNull();
  });
});
