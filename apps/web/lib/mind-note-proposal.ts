import {
  IntakeNoteV1Schema,
  TherapyNoteV1Schema,
  type IntakeNoteV1,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import {
  canonicalIntakeEdit,
  canonicalTreatmentEdit,
  INTAKE_CLINICAL_FIELDS,
  TREATMENT_CLINICAL_FIELDS,
} from './canonical-note-edit';

export type EditableMindNote = IntakeNoteV1 | TherapyNoteV1;
export type MindNoteProposal = { note: EditableMindNote; baseUpdatedAt: string };
export type NarrativeChange = { field: string; label: string; before: string; after: string };

export const NOTE_FIELD_LABELS: Record<string, string> = {
  subjective: 'Client account',
  objective: 'Observations',
  assessment: 'Assessment',
  plan: 'Plan',
  presentingConcerns: 'Presenting concerns',
  historyOfPresentingIllness: 'History of the concern',
  pastPsychiatricHistory: 'Past mental health history',
  familyHistory: 'Family history',
  socialHistory: 'Social history',
  mentalStatusExam: 'Mental status examination',
  workingHypothesis: 'Working hypothesis',
  immediatePlan: 'Immediate plan',
};

/** The preview is bound to the exact draft displayed to this clinician.
 * Only the editable narrative is proposed; model safety/metadata edits never
 * bypass the canonical editor. No browser persistence or automatic apply. */
export function readMindNoteProposal(
  value: unknown,
  current: EditableMindNote,
  baseUpdatedAt: string,
): MindNoteProposal {
  if (!value || typeof value !== 'object')
    throw new Error('The suggested edit could not be read. Your note has not changed.');
  const packet = value as Record<string, unknown>;
  const intake = 'presentingConcerns' in current;
  if (
    packet.applied !== false ||
    packet.baseUpdatedAt !== baseUpdatedAt ||
    packet.kind !== (intake ? 'INTAKE' : 'TREATMENT')
  ) {
    throw new Error(
      'The suggestion does not match this draft. Reload the note before requesting another edit.',
    );
  }
  if (intake) {
    const parsed = IntakeNoteV1Schema.safeParse(packet.note);
    if (parsed.success) return { note: canonicalIntakeEdit(current, parsed.data), baseUpdatedAt };
  } else {
    const parsed = TherapyNoteV1Schema.safeParse(packet.note);
    if (parsed.success)
      return { note: canonicalTreatmentEdit(current, parsed.data), baseUpdatedAt };
  }
  throw new Error('The suggested edit is incomplete. Your note has not changed.');
}

export function narrativeChanges(
  current: EditableMindNote,
  next: EditableMindNote,
): NarrativeChange[] {
  const fields =
    'presentingConcerns' in current ? INTAKE_CLINICAL_FIELDS : TREATMENT_CLINICAL_FIELDS;
  const before = current as unknown as Record<string, unknown>;
  const after = next as unknown as Record<string, unknown>;
  return fields.flatMap((field) =>
    typeof before[field] === 'string' &&
    typeof after[field] === 'string' &&
    before[field] !== after[field]
      ? [
          {
            field,
            label: NOTE_FIELD_LABELS[field] ?? field,
            before: before[field] as string,
            after: after[field] as string,
          },
        ]
      : [],
  );
}
