'use client';

import { useState } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';

/**
 * Batch C — correct the AI-drafted encounter note BEFORE signing it.
 *
 * Until now the sign surface was read-only: "the note is signed as-drafted
 * (no field edits in this MVP)". That left a doctor with two options when
 * Gemini got a line wrong — sign a record they knew was inaccurate, or not
 * sign at all. Neither is acceptable for a medico-legal document, and the
 * therapist vertical has had per-field editing since Sprint 55.
 *
 * Each changed field is returned as a NoteEdit entry, so the signature
 * carries an explicit before/after trail of what the clinician corrected —
 * the note is provably theirs, not the model's.
 *
 * SCOPE: the four narrative fields the sign route validates as signable for
 * a medical note (apps/web/lib/note-edit-fields.ts, MEDICAL). The guarded
 * physical exam, ROS, vitals and linked evidence are frozen at draft — the
 * NoteEdit model is string before/after, so making the exam correctable here
 * would submit a change the route does not validate. That gap is real (an AI
 * can draft an exam that never happened) and needs the edit model widened,
 * not a UI that writes past the validator.
 */

const MOCK_TAG = /^\s*\[mock\]\s*/i;
const clean = (s: string): string => s.replace(MOCK_TAG, '').trim();

/** The narrative fields a doctor corrects in practice. */
const FIELDS = [
  { key: 'chiefComplaint', label: 'Chief complaint', rows: 2 },
  { key: 'hpi', label: 'History of present illness', rows: 5 },
  { key: 'assessment', label: 'Assessment', rows: 4 },
  { key: 'plan', label: 'Plan', rows: 4 },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

export interface NoteFieldEdit {
  field: string;
  before: string;
  after: string;
}

export function MedicalNoteEditor({
  note,
  baseline,
  onCancel,
  onSave,
}: {
  /** The current working note — what the boxes are seeded with. */
  note: MedicalEncounterNoteV1;
  /**
   * The ORIGINAL AI draft. Edits are always diffed against this, so a second
   * pass of corrections still reports "what the AI wrote → what was signed"
   * rather than a chain of intermediate keystrokes. Defaults to `note`.
   */
  baseline?: MedicalEncounterNoteV1;
  onCancel: () => void;
  /** Receives the corrected note plus the per-field before/after trail. */
  onSave: (next: MedicalEncounterNoteV1, edits: NoteFieldEdit[]) => void;
}): React.JSX.Element {
  const base = baseline ?? note;
  const [draft, setDraft] = useState<Record<FieldKey, string>>({
    chiefComplaint: clean(note.chiefComplaint),
    hpi: clean(note.hpi),
    assessment: clean(note.assessment),
    plan: clean(note.plan),
  });
  function save(): void {
    const edits: NoteFieldEdit[] = [];
    const next = { ...note };
    for (const f of FIELDS) {
      // `before` must be the RAW stored draft text: the sign route rejects an
      // edit whose `before` doesn't match the draft byte-for-byte (its stale-
      // draft check). The textarea shows the cleaned text, so compare cleaned
      // but report raw.
      const beforeRaw = base[f.key];
      const after = draft[f.key].trim();
      if (clean(beforeRaw) === after) {
        // Untouched — restore the baseline verbatim. Writing the cleaned
        // string here would look like an unlisted edit to the route.
        next[f.key] = beforeRaw;
      } else {
        next[f.key] = after;
        edits.push({ field: f.key, before: beforeRaw, after });
      }
    }
    onSave(next, edits);
  }

  return (
    <div className="space-y-5">
      {FIELDS.map((f) => (
        <label key={f.key} className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
            {f.label}
          </span>
          <textarea
            value={draft[f.key]}
            rows={f.rows}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-sm leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </label>
      ))}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="button" onClick={save}>
          Save corrections
        </Button>
      </div>
    </div>
  );
}
