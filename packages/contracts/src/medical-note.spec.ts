import { describe, it, expect } from 'vitest';
import {
  MedicalEncounterNoteV1Schema,
  MedicalSessionKindSchema,
  PhysicalExamSchema,
} from './medical-note';

describe('MedicalEncounterNoteV1Schema', () => {
  it('parses a minimal note and applies the defaults', () => {
    const note = MedicalEncounterNoteV1Schema.parse({ version: 'V1' });
    expect(note.encounterKind).toBe('NEW_OPD');
    expect(note.physicalExam).toEqual({ examined: false, findings: '' });
    expect(note.vitals).toEqual({});
    expect(note.reviewOfSystems).toEqual([]);
    expect(note.linkedEvidence).toEqual([]);
  });

  it('defaults the physical exam to NOT examined (anti-hallucination guard)', () => {
    const note = MedicalEncounterNoteV1Schema.parse({
      version: 'V1',
      chiefComplaint: 'Chest pain',
    });
    expect(note.physicalExam.examined).toBe(false);
  });

  it('accepts a fully populated encounter note', () => {
    const note = MedicalEncounterNoteV1Schema.parse({
      version: 'V1',
      encounterKind: 'FOLLOW_UP',
      chiefComplaint: 'Exertional chest pressure ×2 days',
      hpi: 'Retrosternal pressure on exertion, relieved by rest, no radiation.',
      reviewOfSystems: ['Cardiovascular: exertional chest pressure'],
      physicalExam: { examined: true, findings: 'S1S2 normal, no murmurs.' },
      vitals: { bpSystolic: 148, bpDiastolic: 92, heartRateBpm: 88, spo2Pct: 98 },
      assessment: 'Exertional chest pain — rule out stable angina.',
      plan: 'ECG today; aspirin; review in 3 days with reports.',
      linkedEvidence: [{ startMs: 1000, endMs: 4000, quote: 'seene mein pressure' }],
    });
    expect(note.vitals.bpSystolic).toBe(148);
    expect(note.physicalExam.examined).toBe(true);
    expect(note.linkedEvidence).toHaveLength(1);
  });

  it('rejects an out-of-range SpO2', () => {
    expect(() =>
      MedicalEncounterNoteV1Schema.parse({ version: 'V1', vitals: { spo2Pct: 150 } }),
    ).toThrow();
  });

  it('PhysicalExam parses empty input to the guarded default', () => {
    expect(PhysicalExamSchema.parse({})).toEqual({ examined: false, findings: '' });
  });

  it('MedicalSessionKind covers the OPD encounter kinds', () => {
    expect(MedicalSessionKindSchema.options).toContain('NEW_OPD');
    expect(MedicalSessionKindSchema.options).toContain('TELECONSULT');
  });
});
