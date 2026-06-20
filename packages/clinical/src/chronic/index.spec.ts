import { describe, expect, it } from 'vitest';
import { CHRONIC_MEASURES, classifyControl, computeChronicTrend, formatReading } from './index';

describe('classifyControl', () => {
  it('BP < 140/90 is controlled', () => {
    expect(classifyControl('BP', 130, 80)).toBe('controlled');
  });
  it('BP 145/92 is borderline', () => {
    expect(classifyControl('BP', 145, 92)).toBe('borderline');
  });
  it('BP ≥ 160 or ≥ 100 diastolic is uncontrolled', () => {
    expect(classifyControl('BP', 162, 88)).toBe('uncontrolled');
    expect(classifyControl('BP', 150, 104)).toBe('uncontrolled');
  });
  it('requires a diastolic for BP', () => {
    expect(() => classifyControl('BP', 130)).toThrow();
  });

  it('HbA1c < 7 controlled, 7–8 borderline, > 8 uncontrolled', () => {
    expect(classifyControl('HBA1C', 6.5)).toBe('controlled');
    expect(classifyControl('HBA1C', 7.5)).toBe('borderline');
    expect(classifyControl('HBA1C', 9.1)).toBe('uncontrolled');
  });

  it('FBS in 80–130 controlled; hypo (<70) and >160 uncontrolled', () => {
    expect(classifyControl('FBS', 110)).toBe('controlled');
    expect(classifyControl('FBS', 145)).toBe('borderline');
    expect(classifyControl('FBS', 65)).toBe('uncontrolled');
    expect(classifyControl('FBS', 200)).toBe('uncontrolled');
  });

  it('LDL < 100 controlled, > 130 uncontrolled', () => {
    expect(classifyControl('LDL', 90)).toBe('controlled');
    expect(classifyControl('LDL', 120)).toBe('borderline');
    expect(classifyControl('LDL', 160)).toBe('uncontrolled');
  });

  it('weight has no control target', () => {
    expect(classifyControl('WEIGHT', 80)).toBeNull();
  });
});

describe('computeChronicTrend', () => {
  it('BP dropping ≥ 5 mmHg systolic is improving', () => {
    expect(computeChronicTrend('BP', 150, 132)).toBe('improving');
  });
  it('BP rising ≥ 5 mmHg is worsening', () => {
    expect(computeChronicTrend('BP', 130, 150)).toBe('worsening');
  });
  it('a sub-threshold change is stable', () => {
    expect(computeChronicTrend('BP', 140, 137)).toBe('stable');
  });
  it('HbA1c falling 0.6 % is improving; 0.3 % is stable', () => {
    expect(computeChronicTrend('HBA1C', 8.0, 7.4)).toBe('improving');
    expect(computeChronicTrend('HBA1C', 8.0, 7.7)).toBe('stable');
  });
  it('returns null for weight (no clinical direction)', () => {
    expect(computeChronicTrend('WEIGHT', 90, 80)).toBeNull();
  });
});

describe('formatReading', () => {
  it('formats BP as systolic/diastolic', () => {
    expect(formatReading('BP', 130, 80)).toBe('130/80');
  });
  it('keeps one decimal for HbA1c', () => {
    expect(formatReading('HBA1C', 7.25)).toBe('7.3');
  });
  it('rounds whole-number measures', () => {
    expect(formatReading('FBS', 110.6)).toBe('111');
  });
});

describe('registry', () => {
  it('every measure has a target text + unit', () => {
    for (const def of Object.values(CHRONIC_MEASURES)) {
      expect(def.unit.length).toBeGreaterThan(0);
      expect(def.targetText.length).toBeGreaterThan(0);
    }
  });
});
