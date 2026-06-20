import { describe, expect, it } from 'vitest';
import { PreSessionBriefV1Schema, type PreSessionBriefV1 } from './brief';

describe('PreSessionBriefV1Schema', () => {
  const valid: PreSessionBriefV1 = {
    version: 'V1',
    language: 'en',
    contextLine: 'Session 4 of 8 · CBT for panic disorder.',
    lastSessionRecap:
      'Client reported reduced avoidance of work meetings. Sleep improved. Homework completed in full.',
    todaysFocus:
      'Per plan, today move from psychoeducation to cognitive restructuring. Anchor to the goal of attending 1 team meeting weekly.',
    openingLine: '"How did the breathing exercises go this week?"',
    riskWatchpoints: [
      'Re-emergence of meeting-avoidance',
      'Any movement on the sleep-hygiene goal',
    ],
    homeworkStatus: {
      description: 'Catch one anxious thought a day and record it',
      outcome: 'completed',
      notes: null,
    },
    carryoverCrisis: [],
    latestInstruments: [
      {
        instrumentKey: 'PHQ9',
        score: 12,
        severity: 'moderate',
        administeredAt: '2026-05-20T10:00:00.000Z',
      },
    ],
  };

  it('accepts a representative brief', () => {
    expect(PreSessionBriefV1Schema.safeParse(valid).success).toBe(true);
  });

  it('rejects an empty contextLine', () => {
    expect(PreSessionBriefV1Schema.safeParse({ ...valid, contextLine: '' }).success).toBe(false);
  });

  it('accepts a first-session brief (empty recap, no homework, no instruments)', () => {
    expect(
      PreSessionBriefV1Schema.safeParse({
        ...valid,
        lastSessionRecap: '',
        homeworkStatus: null,
        latestInstruments: [],
      }).success,
    ).toBe(true);
  });

  it('rejects > 5 watchpoints', () => {
    expect(
      PreSessionBriefV1Schema.safeParse({
        ...valid,
        riskWatchpoints: ['a', 'b', 'c', 'd', 'e', 'f'],
      }).success,
    ).toBe(false);
  });

  it('rejects a carryover crisis with severity other than high/critical', () => {
    expect(
      PreSessionBriefV1Schema.safeParse({
        ...valid,
        carryoverCrisis: [
          { kind: 'x', severity: 'medium', lastSeenAt: '2026-05-20T10:00:00.000Z' },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts a Malayalam-language brief', () => {
    expect(
      PreSessionBriefV1Schema.safeParse({
        ...valid,
        language: 'ml',
        contextLine: 'സെഷൻ 4 / 8 · പാനിക് ഡിസോർഡറിനുള്ള CBT.',
      }).success,
    ).toBe(true);
  });
});
