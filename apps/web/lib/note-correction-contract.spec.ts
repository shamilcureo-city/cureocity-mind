import { describe, expect, it } from 'vitest';
import { ReviseNoteInputSchema, type MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { noteEditValue } from './note-edit-value';

describe('vertical-aware signed note correction contract', () => {
  it('accepts a medical correction with medical signable fields', () => {
    expect(
      ReviseNoteInputSchema.safeParse({
        kind: 'MEDICAL',
        chiefComplaint: 'Updated complaint',
        hpi: 'Updated HPI',
        reviewOfSystems: ['No chest pain', 'Positive for cough'],
        physicalExam: { examined: true, findings: 'Chest clear to auscultation' },
        vitals: { bpSystolic: 124, bpDiastolic: 82, spo2Pct: 98 },
        assessment: 'Updated assessment',
        plan: 'Updated plan',
        reason: 'Correcting dictated details',
      }).success,
    ).toBe(true);
  });

  it('keeps therapy corrections on the existing SOAP branch', () => {
    expect(
      ReviseNoteInputSchema.safeParse({
        kind: 'TREATMENT',
        subjective: 'Updated subjective',
        reason: 'Correcting patient wording',
      }).success,
    ).toBe(true);
  });

  it('serializes structured medical corrections deterministically for the audit trail', () => {
    const note: MedicalEncounterNoteV1 = {
      version: 'V1',
      encounterKind: 'NEW_OPD',
      chiefComplaint: 'Cough',
      hpi: 'Three days',
      reviewOfSystems: ['No chest pain'],
      physicalExam: { examined: true, findings: 'Chest clear' },
      vitals: { bpSystolic: 124, bpDiastolic: 82 },
      assessment: 'Viral URI',
      plan: 'Supportive care',
      linkedEvidence: [],
    };

    expect(noteEditValue(note, 'vitals')).toBe('{"bpDiastolic":82,"bpSystolic":124}');
    expect(noteEditValue(note, 'physicalExam')).toBe('{"examined":true,"findings":"Chest clear"}');
  });
});
