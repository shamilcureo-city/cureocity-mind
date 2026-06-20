'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { IntakeNoteV1, NoteEditField, TherapyNote } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Label, Textarea } from '../ui/Field';

interface HistoryEntry {
  id: string;
  field: NoteEditField;
  before: string;
  after: string;
  createdAt: string;
}

/**
 * Sprint 55 — post-sign revision for INTAKE notes. Structural twin of
 * RevisionPanel (SOAP), kept as a sibling component because the field
 * set differs in shape, label, and copy. Either both pull a shared
 * primitive later, or both stay split — but no kind-branching inside
 * one component.
 */
type SignedIntakeNote = Omit<TherapyNote, 'content'> & { content: IntakeNoteV1 };

interface Props {
  sessionId: string;
  note: SignedIntakeNote;
  onRevised: (next: IntakeNoteV1) => void;
}

const INTAKE_FIELDS = [
  { key: 'presentingConcerns', label: 'Presenting concerns', rows: 4 },
  { key: 'historyOfPresentingIllness', label: 'History of presenting illness', rows: 4 },
  { key: 'pastPsychiatricHistory', label: 'Past psychiatric history', rows: 3 },
  { key: 'familyHistory', label: 'Family history', rows: 3 },
  { key: 'socialHistory', label: 'Social history', rows: 3 },
  { key: 'mentalStatusExam', label: 'Mental status exam', rows: 4 },
  { key: 'workingHypothesis', label: 'Working hypothesis', rows: 3 },
  { key: 'immediatePlan', label: 'Immediate plan', rows: 3 },
] as const;

type IntakeFieldKey = (typeof INTAKE_FIELDS)[number]['key'];

export function IntakeRevisionPanel({ sessionId, note, onRevised }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [values, setValues] = useState<Record<IntakeFieldKey, string>>(() =>
    INTAKE_FIELDS.reduce(
      (acc, f) => {
        acc[f.key] = note.content[f.key];
        return acc;
      },
      {} as Record<IntakeFieldKey, string>,
    ),
  );
  const [reason, setReason] = useState('');

  useEffect(() => {
    setValues(
      INTAKE_FIELDS.reduce(
        (acc, f) => {
          acc[f.key] = note.content[f.key];
          return acc;
        },
        {} as Record<IntakeFieldKey, string>,
      ),
    );
  }, [note.content]);

  const loadHistory = useCallback(async () => {
    if (history !== null) return;
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/edit-history`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: HistoryEntry[] };
      setHistory(body.items);
    } catch {
      // Quiet fail — history is non-critical.
    }
  }, [history, sessionId]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const payload: Record<string, string> = { kind: 'INTAKE', reason };
      for (const f of INTAKE_FIELDS) {
        if (values[f.key] !== note.content[f.key]) {
          payload[f.key] = values[f.key];
        }
      }
      // Only `kind` + `reason` means nothing changed.
      if (Object.keys(payload).length === 2) {
        setError('No changes to save.');
        setPending(false);
        return;
      }
      // The contract rejects empty fields with an opaque 400 — catch it
      // here with the section label so the therapist can act on it.
      const emptied = Object.keys(payload).find(
        (k) => k !== 'kind' && k !== 'reason' && payload[k].trim().length === 0,
      );
      if (emptied) {
        const label = INTAKE_FIELDS.find((f) => f.key === emptied)?.label ?? emptied;
        setError(`The "${label}" field can't be empty. Add text or cancel that change.`);
        setPending(false);
        return;
      }
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/edit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { content: IntakeNoteV1 };
      onRevised(body.content);
      setHistory(null);
      setMode('idle');
      setReason('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (mode === 'editing') {
    return (
      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Revise signed intake note
          </h3>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            cancel
          </button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          The original text is preserved per field as a NoteEdit row. Add a brief reason so the
          audit log records why the revision was made.
        </p>
        {INTAKE_FIELDS.map((f) => (
          <div key={f.key}>
            <Label htmlFor={`rev-${f.key}`}>{f.label}</Label>
            <Textarea
              id={`rev-${f.key}`}
              rows={f.rows}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </div>
        ))}
        <div>
          <Label htmlFor="rev-reason" hint="5–2000 chars · stored in audit metadata">
            Reason for revision
          </Label>
          <Textarea
            id="rev-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Corrected misremembered date in family history; updated working hypothesis after supervisor input."
            required
          />
        </div>
        {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={pending || reason.trim().length < 5}>
            {pending ? 'Saving…' : 'Save revision'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Revisions</h3>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[var(--color-accent)] hover:underline"
          >
            {historyOpen ? 'hide history' : 'show history'}
          </button>
          <button
            type="button"
            onClick={() => setMode('editing')}
            className="rounded-full bg-[var(--color-ink)] px-3 py-1 text-xs font-medium text-[var(--color-surface)] hover:bg-[var(--color-ink-2)]"
          >
            Revise note
          </button>
        </div>
      </div>
      {historyOpen && (
        <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
          {history === null ? (
            <p className="text-xs text-[var(--color-ink-3)]">Loading…</p>
          ) : history.length === 0 ? (
            <p className="text-xs text-[var(--color-ink-3)]">
              No revisions yet. The note as displayed is the original signed version.
            </p>
          ) : (
            <ol className="space-y-3">
              {history.map((h) => (
                <li key={h.id} className="border-l-2 border-[var(--color-line)] pl-3 text-xs">
                  <p className="text-[var(--color-ink-3)]">
                    {new Date(h.createdAt).toLocaleString('en-GB')} · {h.field}
                  </p>
                  <p className="mt-1 text-[var(--color-warn)]">− {truncate(h.before)}</p>
                  <p className="text-[var(--color-ink)]">+ {truncate(h.after)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(s: string): string {
  if (s.length <= 160) return s;
  return s.slice(0, 157) + '…';
}
