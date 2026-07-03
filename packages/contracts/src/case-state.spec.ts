import { describe, expect, it } from 'vitest';
import { CaseStateSchema, ClinicalFindingSchema, PatientContextSchema } from './case-state';

describe('PatientContextSchema', () => {
  it('fills safe defaults from an empty object', () => {
    const p = PatientContextSchema.parse({});
    expect(p.sex).toBe('unknown');
    expect(p.knownConditions).toEqual([]);
    expect(p.activeMeds).toEqual([]);
    expect(p.allergies).toEqual([]);
    expect(p.age).toBeUndefined();
  });

  it('accepts a populated context', () => {
    const p = PatientContextSchema.parse({ age: 54, sex: 'male', knownConditions: ['HTN'] });
    expect(p.age).toBe(54);
    expect(p.knownConditions).toEqual(['HTN']);
  });

  it('rejects an implausible age', () => {
    expect(PatientContextSchema.safeParse({ age: 999 }).success).toBe(false);
  });
});

describe('ClinicalFindingSchema', () => {
  it('defaults polarity + utteranceIds', () => {
    const f = ClinicalFindingSchema.parse({ id: 'f1', kind: 'symptom', label: 'chest pain' });
    expect(f.polarity).toBe('present');
    expect(f.utteranceIds).toEqual([]);
  });

  it('accepts a negative finding', () => {
    const f = ClinicalFindingSchema.parse({
      id: 'f2',
      kind: 'negative',
      label: 'no breathlessness',
      utteranceIds: ['u1'],
      polarity: 'denied',
    });
    expect(f.kind).toBe('negative');
    expect(f.polarity).toBe('denied');
  });

  it('rejects an unknown kind', () => {
    expect(
      ClinicalFindingSchema.safeParse({ id: 'f3', kind: 'diagnosis', label: 'x' }).success,
    ).toBe(false);
  });
});

describe('CaseStateSchema', () => {
  it('parses a minimal case state with defaults', () => {
    const s = CaseStateSchema.parse({ patient: {} });
    expect(s.findings).toEqual([]);
    expect(s.answeredQuestionIds).toEqual([]);
    expect(s.version).toBe(0);
  });
});
