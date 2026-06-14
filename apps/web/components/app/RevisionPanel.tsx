'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { NoteEditField, TherapyNote, TherapyNoteV1 } from '@cureocity/contracts';
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
 * Sprint 49 — RevisionPanel still revises TREATMENT notes only (the
 * /note/edit route is SOAP-shaped). The caller in NotesTab narrows the
 * union-typed `TherapyNote.content` to TherapyNoteV1 before passing.
 */
type TreatmentNote = Omit<TherapyNote, 'content'> & { content: TherapyNoteV1 };

interface Props {
  sessionId: string;
  note: TreatmentNote;
  onRevised: (next: TherapyNoteV1) => void;
}

/**
 * Post-sign revision UI for the signed therapy note. Renders three
 * states:
 *   1. "Revise note" button + collapsible history list (default)
 *   2. Inline 4-field edit form with required-reason field (when
 *      Revise is clicked)
 *   3. Pending state while POST /note/edit is in-flight
 *
 * History fetches lazily on first expand; on successful revise, the
 * panel pushes the new content up to NotesTab via onRevised so the
 * NotePreview re-renders without a hard reload.
 */
export function RevisionPanel({ sessionId, note, onRevised }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing'>('idle');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subjective, setSubjective] = useState(note.content.subjective);
  const [objective, setObjective] = useState(note.content.objective);
  const [assessment, setAssessment] = useState(note.content.assessment);
  const [plan, setPlan] = useState(note.content.plan);
  const [reason, setReason] = useState('');

  // Keep fields in sync if the note prop changes (e.g. after a revise)
  useEffect(() => {
    setSubjective(note.content.subjective);
    setObjective(note.content.objective);
    setAssessment(note.content.assessment);
    setPlan(note.content.plan);
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
      const payload: Record<string, string> = { kind: 'TREATMENT', reason };
      if (subjective !== note.content.subjective) payload['subjective'] = subjective;
      if (objective !== note.content.objective) payload['objective'] = objective;
      if (assessment !== note.content.assessment) payload['assessment'] = assessment;
      if (plan !== note.content.plan) payload['plan'] = plan;
      if (Object.keys(payload).length === 1) {
        setError('No changes to save.');
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
      const body = (await res.json()) as { content: TherapyNoteV1 };
      onRevised(body.content);
      // Force history re-fetch to include the new entries.
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
            Revise signed note
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
          The original text is preserved per field as a NoteEdit row. Add a brief reason
          so the audit log records why the revision was made.
        </p>
        <div>
          <Label htmlFor="rev-s">Subjective</Label>
          <Textarea
            id="rev-s"
            rows={4}
            value={subjective}
            onChange={(e) => setSubjective(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-o">Objective</Label>
          <Textarea
            id="rev-o"
            rows={4}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-a">Assessment</Label>
          <Textarea
            id="rev-a"
            rows={4}
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-p">Plan</Label>
          <Textarea
            id="rev-p"
            rows={4}
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-reason" hint="5–2000 chars · stored in audit metadata">
            Reason for revision
          </Label>
          <Textarea
            id="rev-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Corrected typo in plan section; added follow-up info from supervisor."
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
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Revisions
        </h3>
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
                <li
                  key={h.id}
                  className="border-l-2 border-[var(--color-line)] pl-3 text-xs"
                >
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
