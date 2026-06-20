import type { NoteEditField } from '@cureocity/contracts';

/**
 * Single source of truth for which note fields are signable / revisable
 * per signable kind. Shared by the sign route (Sprint 49) and the
 * post-sign edit route (Sprint 55) so the two surfaces can't drift — a
 * field that is signable but not revisable (or vice versa) would be a
 * silent clinical-record correctness gap.
 *
 * REVIEW sessions have no note shape of their own; they reuse
 * TREATMENT's SOAP. Callers map the session kind through
 * `signableKindFor` before indexing this table.
 */
export const SIGNABLE_FIELDS_BY_KIND: Record<
  'TREATMENT' | 'INTAKE' | 'MEDICAL',
  readonly NoteEditField[]
> = {
  TREATMENT: ['subjective', 'objective', 'assessment', 'plan'],
  INTAKE: [
    'presentingConcerns',
    'historyOfPresentingIllness',
    'pastPsychiatricHistory',
    'familyHistory',
    'socialHistory',
    'mentalStatusExam',
    'workingHypothesis',
    'immediatePlan',
  ],
  // Sprint DV3 — doctor encounter note. The array/object fields (ROS,
  // physical exam, vitals, linkedEvidence) are frozen at draft; only the
  // narrative strings are field-level signable.
  MEDICAL: ['chiefComplaint', 'hpi', 'assessment', 'plan'],
};

export type SignableKind = keyof typeof SIGNABLE_FIELDS_BY_KIND;

/**
 * Map a parent session's kind to the note shape it signs / revises.
 * INTAKE keeps its own eight-section shape; TREATMENT and REVIEW both
 * sign a SOAP `TherapyNoteV1` (REVIEW is a re-evaluation of an existing
 * treatment, not a distinct document type).
 */
export function signableKindFor(
  sessionKind: 'INTAKE' | 'TREATMENT' | 'REVIEW',
  vertical?: 'THERAPIST' | 'DOCTOR',
): SignableKind {
  // Sprint DV3 — a doctor's session signs a medical encounter note,
  // regardless of the (therapy-shaped) session.kind.
  if (vertical === 'DOCTOR') return 'MEDICAL';
  return sessionKind === 'INTAKE' ? 'INTAKE' : 'TREATMENT';
}
