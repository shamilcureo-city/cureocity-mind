'use client';

import type { TherapyNoteV1 } from '@cureocity/contracts';
import { canonicalTreatmentEdit, TREATMENT_CLINICAL_FIELDS } from '../../lib/canonical-note-edit';
import { ClinicalFieldsEditor } from './ClinicalFieldsEditor';

const FIELDS = [
  { key: 'subjective', label: 'Client account · Subjective', required: true },
  { key: 'objective', label: 'Your observations · Objective', required: true },
  { key: 'assessment', label: 'Clinical understanding · Assessment', required: true },
  { key: 'plan', label: 'The plan', required: true },
] as const;

export function NoteEditor({
  note,
  saving,
  error,
  onSave,
  onCancel,
}: {
  note: TherapyNoteV1;
  saving: boolean;
  error?: string | null;
  onSave: (next: TherapyNoteV1) => void | Promise<void>;
  onCancel: () => void;
}) {
  const initial = Object.fromEntries(TREATMENT_CLINICAL_FIELDS.map((key) => [key, note[key]]));
  return (
    <ClinicalFieldsEditor
      initial={initial}
      fields={FIELDS}
      saving={saving}
      error={error}
      hasDerivedView={Boolean(
        note.summary ||
        note.topics?.length ||
        note.templateSections?.length ||
        note.linkedEvidence.length ||
        note.phaseHints.length ||
        note.modalitySpecific,
      )}
      onCancel={onCancel}
      onSave={(values) =>
        onSave(
          canonicalTreatmentEdit(
            note,
            values as Pick<TherapyNoteV1, (typeof TREATMENT_CLINICAL_FIELDS)[number]>,
          ),
        )
      }
    />
  );
}
