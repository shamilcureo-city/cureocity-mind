import { describe, expect, it } from 'vitest';
import { GAD7, INSTRUMENTS, InstrumentScoringError, PHQ9, scoreInstrument } from './index';

describe('PHQ-9 catalogue', () => {
  it('has exactly 9 items', () => {
    expect(PHQ9.items).toHaveLength(9);
  });

  it('item #9 is the risk item', () => {
    expect(PHQ9.riskItemNumber).toBe(9);
  });

  it('severity bands cover 0..27 with no gaps', () => {
    const sorted = [...PHQ9.severityBands].sort((a, b) => a.min - b.min);
    expect(sorted[0]!.min).toBe(0);
    expect(sorted[sorted.length - 1]!.max).toBe(27);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.min).toBe(sorted[i - 1]!.max + 1);
    }
  });

  it('scale options are 0..3 in order', () => {
    expect(PHQ9.scale.map((s) => s.value)).toEqual([0, 1, 2, 3]);
  });
});

describe('GAD-7 catalogue', () => {
  it('has exactly 7 items', () => {
    expect(GAD7.items).toHaveLength(7);
  });

  it('severity bands cover 0..21', () => {
    expect(GAD7.severityBands[0]!.min).toBe(0);
    expect(GAD7.severityBands[GAD7.severityBands.length - 1]!.max).toBe(21);
  });

  it('has no risk item (no suicidality screen)', () => {
    expect(GAD7.riskItemNumber).toBeUndefined();
  });
});

describe('scoreInstrument', () => {
  it('PHQ-9 score 0 → minimal', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 0]));
    const result = scoreInstrument(PHQ9, responses);
    expect(result.score).toBe(0);
    expect(result.severityKey).toBe('minimal');
    expect(result.riskFlagged).toBe(false);
  });

  it('PHQ-9 score 27 → severe + risk flagged', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 3]));
    const result = scoreInstrument(PHQ9, responses);
    expect(result.score).toBe(27);
    expect(result.severityKey).toBe('severe');
    expect(result.riskFlagged).toBe(true);
  });

  it('PHQ-9 score 12 → moderate', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 0]));
    responses['phq9_1'] = 2;
    responses['phq9_2'] = 3;
    responses['phq9_3'] = 3;
    responses['phq9_4'] = 2;
    responses['phq9_5'] = 2;
    const result = scoreInstrument(PHQ9, responses);
    expect(result.score).toBe(12);
    expect(result.severityKey).toBe('moderate');
    expect(result.riskFlagged).toBe(false);
  });

  it('GAD-7 score 7 → mild', () => {
    const responses = Object.fromEntries(GAD7.items.map((it) => [it.id, 1]));
    const result = scoreInstrument(GAD7, responses);
    expect(result.score).toBe(7);
    expect(result.severityKey).toBe('mild');
  });

  it('GAD-7 score 14 → moderate', () => {
    const responses = Object.fromEntries(GAD7.items.map((it) => [it.id, 2]));
    const result = scoreInstrument(GAD7, responses);
    expect(result.score).toBe(14);
    expect(result.severityKey).toBe('moderate');
  });

  it('throws on missing item', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 1]));
    delete responses['phq9_5'];
    expect(() => scoreInstrument(PHQ9, responses)).toThrow(InstrumentScoringError);
  });

  it('throws on out-of-range value', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 1]));
    responses['phq9_1'] = 4;
    expect(() => scoreInstrument(PHQ9, responses)).toThrow(InstrumentScoringError);
  });

  it('throws on non-integer value', () => {
    const responses = Object.fromEntries(PHQ9.items.map((it) => [it.id, 1]));
    responses['phq9_1'] = 1.5;
    expect(() => scoreInstrument(PHQ9, responses)).toThrow(InstrumentScoringError);
  });
});

describe('INSTRUMENTS registry', () => {
  it('contains PHQ9 + GAD7', () => {
    expect(Object.keys(INSTRUMENTS).sort()).toEqual(['GAD7', 'PHQ9']);
  });
});
