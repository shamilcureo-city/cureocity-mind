import type { IntakeNoteV1, TherapyNoteV1 } from '@cureocity/contracts';

export const TREATMENT_CLINICAL_FIELDS = ['subjective', 'objective', 'assessment', 'plan'] as const;
export const INTAKE_CLINICAL_FIELDS = [
  'presentingConcerns',
  'historyOfPresentingIllness',
  'pastPsychiatricHistory',
  'familyHistory',
  'socialHistory',
  'mentalStatusExam',
  'workingHypothesis',
  'immediatePlan',
] as const;

/** Manual clinical corrections cannot leave older generated projections in the
 * same signed object. Preserve all safety/modality fields and remove only views. */
export function canonicalTreatmentEdit(
  note: TherapyNoteV1,
  fields: Pick<TherapyNoteV1, (typeof TREATMENT_CLINICAL_FIELDS)[number]>,
): TherapyNoteV1 {
  const next = {
    ...note,
    ...Object.fromEntries(TREATMENT_CLINICAL_FIELDS.map((key) => [key, fields[key]])),
  };
  delete next.summary;
  delete next.topics;
  delete next.templateSections;
  next.linkedEvidence = [];
  next.phaseHints = [];
  return next;
}

export function canonicalIntakeEdit(
  note: IntakeNoteV1,
  fields: Pick<IntakeNoteV1, (typeof INTAKE_CLINICAL_FIELDS)[number]>,
): IntakeNoteV1 {
  const next = {
    ...note,
    ...Object.fromEntries(INTAKE_CLINICAL_FIELDS.map((key) => [key, fields[key]])),
  };
  delete next.templateSections;
  next.linkedEvidence = [];
  return next;
}

export function noteEditIsDirty(
  initial: Record<string, string>,
  edited: Record<string, string>,
): boolean {
  return Object.keys(initial).some((field) => initial[field] !== edited[field]);
}
