import { describe, expect, it } from 'vitest';
import {
  computeInstrumentChange,
  computeInstrumentTrajectory,
  severityKeyForScore,
  REMISSION_CUTOFF,
  RELIABLE_CHANGE_THRESHOLD,
  InstrumentChangeError,
} from './change-score';

describe('severityKeyForScore', () => {
  it('maps PHQ-9 scores to the right band', () => {
    expect(severityKeyForScore('PHQ9', 0)).toBe('minimal');
    expect(severityKeyForScore('PHQ9', 4)).toBe('minimal');
    expect(severityKeyForScore('PHQ9', 5)).toBe('mild');
    expect(severityKeyForScore('PHQ9', 12)).toBe('moderate');
    expect(severityKeyForScore('PHQ9', 18)).toBe('moderately_severe');
    expect(severityKeyForScore('PHQ9', 27)).toBe('severe');
  });

  it('maps GAD-7 scores to the right band', () => {
    expect(severityKeyForScore('GAD7', 0)).toBe('minimal');
    expect(severityKeyForScore('GAD7', 9)).toBe('mild');
    expect(severityKeyForScore('GAD7', 14)).toBe('moderate');
    expect(severityKeyForScore('GAD7', 21)).toBe('severe');
  });

  it('throws on an out-of-range score', () => {
    expect(() => severityKeyForScore('PHQ9', 28)).toThrow(InstrumentChangeError);
    expect(() => severityKeyForScore('GAD7', 22)).toThrow(InstrumentChangeError);
  });
});

describe('computeInstrumentChange — verdict', () => {
  it('flags reliable improvement when the drop meets the PHQ-9 threshold', () => {
    // 18 → 13 is exactly a 5-point drop (the PHQ-9 reliable-change threshold).
    const change = computeInstrumentChange('PHQ9', 18, 13);
    expect(change.delta).toBe(-5);
    expect(change.verdict).toBe('reliable_improvement');
  });

  it('does NOT flag reliable change for a sub-threshold drop', () => {
    // 18 → 14 is only 4 points — below the PHQ-9 threshold of 5.
    const change = computeInstrumentChange('PHQ9', 18, 14);
    expect(change.verdict).toBe('no_reliable_change');
  });

  it('flags deterioration when the score climbs past the threshold', () => {
    const change = computeInstrumentChange('PHQ9', 8, 15);
    expect(change.delta).toBe(7);
    expect(change.verdict).toBe('deterioration');
  });

  it('uses the GAD-7 threshold of 4 points', () => {
    expect(computeInstrumentChange('GAD7', 15, 11).verdict).toBe('reliable_improvement'); // -4
    expect(computeInstrumentChange('GAD7', 15, 12).verdict).toBe('no_reliable_change'); // -3
  });

  it('keeps the thresholds in sync with the exported constants', () => {
    expect(RELIABLE_CHANGE_THRESHOLD.PHQ9).toBe(5);
    expect(RELIABLE_CHANGE_THRESHOLD.GAD7).toBe(4);
  });
});

describe('computeInstrumentChange — response + remission', () => {
  it('marks response at exactly 50% reduction', () => {
    const change = computeInstrumentChange('PHQ9', 18, 9);
    expect(change.isResponse).toBe(true);
  });

  it('does not mark response below 50% reduction', () => {
    const change = computeInstrumentChange('PHQ9', 18, 10);
    expect(change.isResponse).toBe(false);
  });

  it('marks remission at or below the cutoff', () => {
    expect(computeInstrumentChange('PHQ9', 18, 4).isRemission).toBe(true);
    expect(computeInstrumentChange('PHQ9', 18, 5).isRemission).toBe(false);
    expect(REMISSION_CUTOFF.PHQ9).toBe(4);
  });

  it('reports both response and remission for a strong improvement (18 → 4)', () => {
    const change = computeInstrumentChange('PHQ9', 18, 4);
    expect(change.verdict).toBe('reliable_improvement');
    expect(change.isResponse).toBe(true);
    expect(change.isRemission).toBe(true);
    expect(change.baselineSeverityKey).toBe('moderately_severe');
    expect(change.latestSeverityKey).toBe('minimal');
  });
});

describe('computeInstrumentChange — percentChange + edge cases', () => {
  it('computes percentChange relative to baseline', () => {
    expect(computeInstrumentChange('PHQ9', 20, 10).percentChange).toBe(-50);
    expect(computeInstrumentChange('PHQ9', 10, 15).percentChange).toBe(50);
  });

  it('returns null percentChange when baseline is 0', () => {
    const change = computeInstrumentChange('PHQ9', 0, 0);
    expect(change.percentChange).toBeNull();
    expect(change.isResponse).toBe(false);
    expect(change.verdict).toBe('no_reliable_change');
  });

  it('a flat baseline=0 → climb of 6 is deterioration with null percent', () => {
    const change = computeInstrumentChange('PHQ9', 0, 6);
    expect(change.verdict).toBe('deterioration');
    expect(change.percentChange).toBeNull();
  });

  it('throws on non-finite scores', () => {
    expect(() => computeInstrumentChange('PHQ9', Number.NaN, 5)).toThrow(InstrumentChangeError);
  });
});

describe('computeInstrumentTrajectory — relapse detection', () => {
  it('returns null for fewer than two readings', () => {
    expect(computeInstrumentTrajectory('PHQ9', [])).toBeNull();
    expect(computeInstrumentTrajectory('PHQ9', [12])).toBeNull();
  });

  it('flags a slide back from the nadir the first-vs-latest verdict misses', () => {
    // 18 → 8 → 16: first-vs-latest is only -2 (no reliable change), but the
    // rise from the nadir of 8 to 16 is +8 ≥ the PHQ-9 threshold of 5.
    const traj = computeInstrumentTrajectory('PHQ9', [18, 8, 16]);
    expect(traj?.nadir).toBe(8);
    expect(traj?.peak).toBe(18);
    expect(traj?.latest).toBe(16);
    expect(traj?.recentlyWorsening).toBe(true);
    expect(computeInstrumentChange('PHQ9', 18, 16).verdict).toBe('no_reliable_change');
  });

  it('does not flag a steady improver', () => {
    expect(computeInstrumentTrajectory('PHQ9', [18, 11, 8])?.recentlyWorsening).toBe(false);
  });

  it('does not over-trigger on a sub-threshold wobble', () => {
    // 8 → 6 → 9: the rise from nadir 6 to 9 is +3, below the threshold of 5.
    expect(computeInstrumentTrajectory('PHQ9', [8, 6, 9])?.recentlyWorsening).toBe(false);
  });

  it('uses the tighter GAD-7 threshold of 4', () => {
    // Rise from nadir 5 to 9 is +4 = the GAD-7 threshold.
    expect(computeInstrumentTrajectory('GAD7', [12, 5, 9])?.recentlyWorsening).toBe(true);
    expect(computeInstrumentTrajectory('GAD7', [12, 5, 8])?.recentlyWorsening).toBe(false); // +3
  });
});
