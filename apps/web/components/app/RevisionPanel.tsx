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
 * The /note/edit route is SOAP-shaped; NotesTab narrows the union-typed
 * TherapyNote.content to TherapyNoteV1 before passing.
 */
type TreatmentNote = Omit<TherapyNote, 'content'> & { content: TherapyNoteV1 };

interface Props {
  sessionId: string;
  note: TreatmentNote;
  onRevised: (next: TherapyNoteV1) => void;
}

const FIELD_LABEL: Record<string, string> = {
  subjective: 'What the client shared',
  objective: 'What you observed',
  assessment: 'Assessment',
  plan: 'Plan',
};

/**
 * Edit + version history for a signed note. Replaces the old "Revisions /
 * reason" ceremony with a plain Edit: the therapist edits the note and saves;
 * every saved change is kept as a version and listed here in the note block.
 * Under the hood each save still goes through /note/edit (which keeps the
 * per-field before/after trail), with the reason auto-filled.
 */
export function RevisionPanel({ sessionId, note, onRevised }: Props) {
  const [mode, setMode] = useState<'idle' | 'editing'>('idle');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [subjective, setSubjective] = useState(note.content.subjective);
  const [objective, setObjective] = useState(note.content.objective);
  const [assessment, setAssessment] = useState(note.content.assessment);
  const [plan, setPlan] = useState(note.content.plan);

  useEffect(() => {
    setSubjective(note.content.subjective);
    setObjective(note.content.objective);
    setAssessment(note.content.assessment);
    setPlan(note.content.plan);
  }, [note.content]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/edit-history`);
      if (!res.ok) return;
      const body = (await res.json()) as { items: HistoryEntry[] };
      setHistory(body.items);
    } catch {
      // Quiet fail — history is non-critical.
    }
  }, [sessionId]);

  // Show version history right away (it's "in the big block").
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const payload: Record<string, string> = {
        kind: 'TREATMENT',
        // Auto-filled so the therapist doesn't have to justify a plain edit;
        // the audit trail still records that a change was made.
        reason: 'Edited in the note editor',
      };
      if (subjective !== note.content.subjective) payload['subjective'] = subjective;
      if (objective !== note.content.objective) payload['objective'] = objective;
      if (assessment !== note.content.assessment) payload['assessment'] = assessment;
      if (plan !== note.content.plan) payload['plan'] = plan;
      if (Object.keys(payload).length === 2) {
        setError('No changes to save.');
        setPending(false);
        return;
      }
      const emptied = Object.keys(payload).find(
        (k) => k !== 'kind' && k !== 'reason' && payload[k].trim().length === 0,
      );
      if (emptied) {
        setError(`"${FIELD_LABEL[emptied] ?? emptied}" can't be empty.`);
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
      setMode('idle');
      setHistory(null);
      await loadHistory();
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
          <h3 className="font-serif text-lg text-[var(--color-ink)]">Edit note</h3>
          <button
            type="button"
            onClick={() => setMode('idle')}
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            cancel
          </button>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          Every change is kept as a version below — nothing is lost.
        </p>
        <div>
          <Label htmlFor="rev-s">{FIELD_LABEL['subjective']}</Label>
          <Textarea
            id="rev-s"
            rows={4}
            value={subjective}
            onChange={(e) => setSubjective(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-o">{FIELD_LABEL['objective']}</Label>
          <Textarea
            id="rev-o"
            rows={4}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-a">{FIELD_LABEL['assessment']}</Label>
          <Textarea
            id="rev-a"
            rows={4}
            value={assessment}
            onChange={(e) => setAssessment(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="rev-p">{FIELD_LABEL['plan']}</Label>
          <Textarea id="rev-p" rows={4} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </div>
        {error && <p className="text-sm text-[var(--color-warn)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-[var(--color-ink)]">Version history</h3>
        <button
          type="button"
          onClick={() => setMode('editing')}
          className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
        >
          Edit note
        </button>
      </div>
      <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
        {history === null ? (
          <p className="text-xs text-[var(--color-ink-3)]">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-3)]">
            No edits yet — this is the original note. Each edit you save appears here as a version.
          </p>
        ) : (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="border-l-2 border-[var(--color-line)] pl-3 text-xs">
                <p className="text-[var(--color-ink-3)]">
                  {new Date(h.createdAt).toLocaleString('en-GB')} ·{' '}
                  {FIELD_LABEL[h.field] ?? h.field}
                </p>
                <p className="mt-1 text-[var(--color-warn)]">− {truncate(h.before)}</p>
                <p className="text-[var(--color-ink)]">+ {truncate(h.after)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function truncate(s: string): string {
  if (s.length <= 160) return s;
  return s.slice(0, 157) + '…';
}
