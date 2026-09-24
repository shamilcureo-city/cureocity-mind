'use client';

import { useState } from 'react';
import {
  MedicalEncounterNoteV1Schema,
  type MedicalEncounterNoteV1,
  type NoteEditField,
} from '@cureocity/contracts';
import { noteEditValue } from '@/lib/note-edit-value';
import { Button } from '../ui/Button';
import { Input, Label } from '../ui/Field';

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
 * Every clinician-owned field is correctable here. Structured fields use
 * canonical JSON in NoteEdit.before/after, while linkedEvidence stays
 * immutable provenance.
 */

const MOCK_TAG = /^\s*\[mock\]\s*/i;
const clean = (s: string): string => s.replace(MOCK_TAG, '').trim();

const NARRATIVE_FIELDS = [
  { key: 'chiefComplaint', label: 'Chief complaint', rows: 2 },
  { key: 'hpi', label: 'History of present illness', rows: 5 },
  { key: 'assessment', label: 'Assessment', rows: 4 },
  { key: 'plan', label: 'Plan', rows: 4 },
] as const;

type FieldKey = (typeof NARRATIVE_FIELDS)[number]['key'];

const EDITABLE_FIELDS: NoteEditField[] = [
  'chiefComplaint',
  'hpi',
  'reviewOfSystems',
  'physicalExam',
  'vitals',
  'assessment',
  'plan',
];

type VitalsDraft = Record<keyof MedicalEncounterNoteV1['vitals'], string>;

const vitalFields: Array<{
  key: keyof VitalsDraft;
  label: string;
  placeholder: string;
  decimal?: boolean;
}> = [
  { key: 'bpSystolic', label: 'BP systolic', placeholder: '120' },
  { key: 'bpDiastolic', label: 'BP diastolic', placeholder: '80' },
  { key: 'heartRateBpm', label: 'Heart rate', placeholder: '72' },
  { key: 'respRateBpm', label: 'Respiratory rate', placeholder: '16' },
  { key: 'tempCelsius', label: 'Temperature °C', placeholder: '37.0', decimal: true },
  { key: 'spo2Pct', label: 'SpO₂ %', placeholder: '98' },
  { key: 'weightKg', label: 'Weight kg', placeholder: '70', decimal: true },
];

export interface NoteFieldEdit {
  field: NoteEditField;
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
  const [reviewOfSystems, setReviewOfSystems] = useState(note.reviewOfSystems.join('\n'));
  const [examined, setExamined] = useState(note.physicalExam.examined);
  const [examFindings, setExamFindings] = useState(note.physicalExam.findings);
  const [vitals, setVitals] = useState<VitalsDraft>({
    bpSystolic: note.vitals.bpSystolic?.toString() ?? '',
    bpDiastolic: note.vitals.bpDiastolic?.toString() ?? '',
    heartRateBpm: note.vitals.heartRateBpm?.toString() ?? '',
    respRateBpm: note.vitals.respRateBpm?.toString() ?? '',
    tempCelsius: note.vitals.tempCelsius?.toString() ?? '',
    spo2Pct: note.vitals.spo2Pct?.toString() ?? '',
    weightKg: note.vitals.weightKg?.toString() ?? '',
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  function save(): void {
    setValidationError(null);
    const candidate = {
      ...note,
      chiefComplaint: draft.chiefComplaint.trim(),
      hpi: draft.hpi.trim(),
      reviewOfSystems: reviewOfSystems
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      physicalExam: {
        examined,
        findings: examined ? examFindings.trim() : '',
      },
      vitals: Object.fromEntries(
        vitalFields.flatMap(({ key }) => {
          const raw = vitals[key].trim();
          return raw ? [[key, Number(raw)]] : [];
        }),
      ) as MedicalEncounterNoteV1['vitals'],
      assessment: draft.assessment.trim(),
      plan: draft.plan.trim(),
    };
    const parsed = MedicalEncounterNoteV1Schema.safeParse(candidate);
    if (!parsed.success) {
      setValidationError('Check the vital values and clinical fields before saving.');
      return;
    }

    const edits = EDITABLE_FIELDS.flatMap((field): NoteFieldEdit[] => {
      const before = noteEditValue(base, field);
      const after = noteEditValue(parsed.data, field);
      return before === after ? [] : [{ field, before, after }];
    });
    onSave(parsed.data, edits);
  }

  return (
    <div className="space-y-5">
      {NARRATIVE_FIELDS.slice(0, 2).map((f) => (
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

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Review of systems
        </span>
        <textarea
          value={reviewOfSystems}
          rows={4}
          onChange={(e) => setReviewOfSystems(e.target.value)}
          placeholder="One pertinent positive or negative per line"
          className="mt-1.5 w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-sm leading-relaxed text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </label>

      <fieldset className="space-y-3 rounded-xl border border-[var(--color-line)] p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Physical examination
        </legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={examined}
            onChange={(e) => setExamined(e.target.checked)}
          />
          Examination performed and stated in the consult
        </label>
        <textarea
          value={examFindings}
          rows={3}
          disabled={!examined}
          onChange={(e) => setExamFindings(e.target.value)}
          placeholder={examined ? 'Enter only findings actually examined' : 'Not examined'}
          className="w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-sm leading-relaxed text-[var(--color-ink)] disabled:bg-[var(--color-surface-soft)] disabled:text-[var(--color-ink-3)]"
        />
      </fieldset>

      <fieldset className="rounded-xl border border-[var(--color-line)] p-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Vitals
        </legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vitalFields.map((field) => (
            <div key={field.key}>
              <Label htmlFor={`note-vital-${field.key}`}>{field.label}</Label>
              <Input
                id={`note-vital-${field.key}`}
                inputMode={field.decimal ? 'decimal' : 'numeric'}
                value={vitals[field.key]}
                onChange={(e) =>
                  setVitals((current) => ({ ...current, [field.key]: e.target.value }))
                }
                placeholder={field.placeholder}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {NARRATIVE_FIELDS.slice(2).map((f) => (
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

      {validationError && <p className="text-sm text-[var(--color-warn)]">{validationError}</p>}

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
