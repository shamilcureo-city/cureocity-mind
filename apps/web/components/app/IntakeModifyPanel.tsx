'use client';

import { useState } from 'react';
import type { IntakeNoteV1 } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface Props {
  sessionId: string;
  note: IntakeNoteV1;
  onModified: (next: IntakeNoteV1) => void;
}

const QUICK_INSTRUCTIONS = [
  'Tighten the history section to one paragraph',
  'Rewrite mental status exam as a prose paragraph',
  'Remove any specific names from social history',
  'Make the immediate plan more concrete',
];

/**
 * Sprint 21 — AI modify panel for intake notes.
 *
 * Sibling of the SOAP ModifyPanel but for IntakeNoteV1. Sends a
 * free-text instruction to /sessions/[id]/note/modify which, when
 * session.kind === INTAKE, runs the intake-specific system prompt and
 * returns the modified note. Pre-sign only — intake notes can't yet
 * be signed (sign route is TherapyNoteV1-shaped).
 */
export function IntakeModifyPanel({ sessionId, note, onModified }: Props) {
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changedFields, setChangedFields] = useState<string[] | null>(null);

  async function submit(text: string): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction: text }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        note?: IntakeNoteV1;
        changedFields?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Modify failed (${res.status})`);
      if (body.note) {
        onModified(body.note);
        setChangedFields(body.changedFields ?? []);
        setInstruction('');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Reuse the existing note's risk flags severity is server-enforced;
  // the panel doesn't need to spell that out.
  return (
    <Card className="p-6">
      <header className="mb-3">
        <h3 className="font-serif text-lg">Modify intake note</h3>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Ask in plain language; the AI rewrites the draft. Server-side guards keep risk severity
          and structure stable.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {QUICK_INSTRUCTIONS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => void submit(q)}
            disabled={submitting}
            className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs text-[var(--color-ink-2)] hover:border-[var(--color-ink-3)] disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={3}
        placeholder="e.g. Expand the working hypothesis with the differential I mentioned."
        className="w-full rounded-xl border border-[var(--color-line)] bg-white p-3 text-sm focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]"
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-[var(--color-ink-3)]">
          {changedFields && changedFields.length > 0
            ? `Last run changed: ${changedFields.join(', ')}`
            : changedFields && changedFields.length === 0
              ? 'Last run made no changes.'
              : ''}
        </span>
        <Button
          onClick={() => void submit(instruction.trim())}
          disabled={submitting || instruction.trim().length < 3}
        >
          {submitting ? 'Modifying…' : 'Modify'}
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--color-warn)]">{error}</p>}

      <p className="mt-3 text-xs italic text-[var(--color-ink-3)]">
        Intake notes can't be signed yet — that's deferred until the sign contract is generalised.
        Modifications save to the draft.
      </p>

      {/* `note` is consumed by the parent for re-render — referenced here to silence the
          unused-prop lint without changing the component contract. */}
      <span hidden aria-hidden>
        {note.version}
      </span>
    </Card>
  );
}
