'use client';

import { useState } from 'react';
import type { IntakeNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';

/**
 * Inline editor for a completed intake note — the intake twin of NoteEditor.
 * One box per intake section, under the same therapist-friendly headings the
 * IntakeNotePreview shows. Risk severity is force-preserved by the server on
 * save, so it isn't exposed here.
 */

interface Props {
  note: IntakeNoteV1;
  saving: boolean;
  error?: string | null;
  onSave: (next: IntakeNoteV1) => void | Promise<void>;
  onCancel: () => void;
}

const FIELD =
  'w-full rounded-xl border border-[var(--color-line)] bg-white px-3 py-2 text-[15px] leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]';

// Same friendly labels as IntakeNotePreview, in document order. `required`
// mirrors the IntakeNoteV1 schema (.min(1)) so an empty box gives a clear
// inline message instead of an opaque 422 from the server.
const FIELDS = [
  { key: 'presentingConcerns', label: 'Why they came', rows: 4, required: true },
  { key: 'historyOfPresentingIllness', label: 'The story so far', rows: 5, required: true },
  { key: 'pastPsychiatricHistory', label: 'Past mental-health care', rows: 3, required: false },
  { key: 'familyHistory', label: 'Family background', rows: 3, required: false },
  { key: 'socialHistory', label: 'Life & circumstances', rows: 3, required: false },
  { key: 'mentalStatusExam', label: 'Mental state today', rows: 4, required: true },
  { key: 'workingHypothesis', label: 'Working hypothesis', rows: 3, required: true },
  { key: 'immediatePlan', label: 'The plan', rows: 4, required: true },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

export function IntakeNoteEditor({ note, saving, error, onSave, onCancel }: Props) {
  const [values, setValues] = useState<Record<FieldKey, string>>(() =>
    FIELDS.reduce(
      (acc, f) => {
        acc[f.key] = note[f.key];
        return acc;
      },
      {} as Record<FieldKey, string>,
    ),
  );
  const [localError, setLocalError] = useState<string | null>(null);

  function save(): void {
    const emptyRequired = FIELDS.find((f) => f.required && !values[f.key].trim());
    if (emptyRequired) {
      setLocalError(`“${emptyRequired.label}” can’t be empty.`);
      return;
    }
    setLocalError(null);
    void onSave({ ...note, ...values });
  }

  return (
    <div className="space-y-6">
      {FIELDS.map((f) => (
        <Field key={f.key} label={f.label}>
          <textarea
            rows={f.rows}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            className={FIELD}
          />
        </Field>
      ))}

      {(localError ?? error) && (
        <p className="text-sm text-[var(--color-warn)]">{localError ?? error}</p>
      )}

      <div className="flex items-center gap-2 border-t border-[var(--color-line-soft)] pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save note'}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-[var(--color-ink)]">{label}</label>
      {children}
    </div>
  );
}
