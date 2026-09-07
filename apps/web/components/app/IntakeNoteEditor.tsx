'use client';

import type { IntakeNoteV1 } from '@cureocity/contracts';
import { canonicalIntakeEdit, INTAKE_CLINICAL_FIELDS } from '../../lib/canonical-note-edit';
import { ClinicalFieldsEditor } from './ClinicalFieldsEditor';
import type { NoteEditRecoveryTarget } from '../../lib/note-edit-recovery-client';

const FIELDS = [
  { key: 'presentingConcerns', label: 'Why they came', required: true },
  { key: 'historyOfPresentingIllness', label: 'The story so far', required: true },
  { key: 'pastPsychiatricHistory', label: 'Past mental-health care' },
  { key: 'familyHistory', label: 'Family background' },
  { key: 'socialHistory', label: 'Life and circumstances' },
  { key: 'mentalStatusExam', label: 'Mental state today', required: true },
  { key: 'workingHypothesis', label: 'Working hypothesis', required: true },
  { key: 'immediatePlan', label: 'The plan', required: true },
] as const;

export function IntakeNoteEditor({
  note,
  saving,
  error,
  onSave,
  onCancel,
  recoveryTarget,
}: {
  note: IntakeNoteV1;
  saving: boolean;
  error?: string | null;
  onSave: (
    next: IntakeNoteV1,
    recoveryRevision?: number,
  ) => void | boolean | Promise<void | boolean>;
  onCancel: () => void;
  recoveryTarget?: NoteEditRecoveryTarget;
}) {
  const initial = Object.fromEntries(INTAKE_CLINICAL_FIELDS.map((key) => [key, note[key]]));
  return (
    <ClinicalFieldsEditor
      initial={initial}
      fields={FIELDS}
      saving={saving}
      error={error}
      recoveryTarget={recoveryTarget}
      hasDerivedView={Boolean(note.templateSections?.length || note.linkedEvidence.length)}
      onCancel={onCancel}
      onSave={(values, revision) =>
        onSave(
          canonicalIntakeEdit(
            note,
            values as Pick<IntakeNoteV1, (typeof INTAKE_CLINICAL_FIELDS)[number]>,
          ),
          revision,
        )
      }
    />
  );
}
