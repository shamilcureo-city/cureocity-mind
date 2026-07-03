import { describe, expect, it } from 'vitest';
import { RxMedRowSchema, RxPadDraftSchema, RxPadV1Schema } from './rx-pad';

describe('RxMedRowSchema', () => {
  it('defaults continued/status/warnings', () => {
    const m = RxMedRowSchema.parse({ drug: 'Aspirin' });
    expect(m.continued).toBe(false);
    expect(m.status).toBe('pending');
    expect(m.warnings).toEqual([]);
  });

  it('accepts a confirmed continued med with Indian dosing shorthand', () => {
    const m = RxMedRowSchema.parse({
      drug: 'Amlodipine',
      strength: '5 mg',
      frequency: '1-0-0',
      timing: 'after food',
      durationDays: 30,
      continued: true,
      status: 'confirmed',
    });
    expect(m.continued).toBe(true);
    expect(m.status).toBe('confirmed');
    expect(m.frequency).toBe('1-0-0');
  });

  it('rejects an unknown status', () => {
    expect(RxMedRowSchema.safeParse({ drug: 'x', status: 'auto' }).success).toBe(false);
  });
});

describe('RxPadV1Schema', () => {
  it('defaults version + empty sections', () => {
    const pad = RxPadV1Schema.parse({});
    expect(pad.version).toBe('V1');
    expect(pad.meds).toEqual([]);
    expect(pad.investigations).toEqual([]);
    expect(pad.adviceLines).toEqual([]);
    expect(pad.allergies).toEqual([]);
  });

  it('parses a populated pad', () => {
    const pad = RxPadV1Schema.parse({
      dxLine: 'Stable angina',
      meds: [{ drug: 'Aspirin', strength: '75 mg', frequency: '0-0-1', status: 'confirmed' }],
      investigations: [{ name: '12-lead ECG', rationale: 'screen for ischaemia' }],
      adviceLines: ['Avoid heavy exertion until reviewed'],
      followUp: { when: 'in 3 days', withWhat: 'ECG + lipid report' },
      vitalsLine: 'BP 148/92 · HR 88',
    });
    expect(pad.meds[0]!.drug).toBe('Aspirin');
    expect(pad.followUp?.when).toBe('in 3 days');
  });
});

describe('RxPadDraftSchema', () => {
  it('allows a partial live pad', () => {
    const draft = RxPadDraftSchema.parse({ dxLine: 'working on it' });
    expect(draft.dxLine).toBe('working on it');
    expect(draft.meds).toBeUndefined();
  });
});
