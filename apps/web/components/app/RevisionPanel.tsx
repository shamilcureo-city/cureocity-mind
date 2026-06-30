'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NoteEditField } from '@cureocity/contracts';

interface HistoryEntry {
  id: string;
  field: NoteEditField;
  before: string;
  after: string;
  createdAt: string;
}

interface Props {
  sessionId: string;
  /** Re-open the signed note for editing (unlock → full editable toolbar). */
  onUnlock: () => void | Promise<void>;
  unlocking: boolean;
}

const FIELD_LABEL: Record<string, string> = {
  // SOAP (treatment / review) fields.
  subjective: 'What the client shared',
  objective: 'What you observed',
  assessment: 'Assessment',
  plan: 'Plan',
  // Intake fields — same friendly headings the note itself shows, so the
  // shared Version history block reads cleanly for intake notes too.
  presentingConcerns: 'Why they came',
  historyOfPresentingIllness: 'The story so far',
  pastPsychiatricHistory: 'Past mental-health care',
  familyHistory: 'Family background',
  socialHistory: 'Life & circumstances',
  mentalStatusExam: 'Mental state today',
  workingHypothesis: 'Working hypothesis',
  immediatePlan: 'The plan',
};

/**
 * Sprint 71 — the signed note's "Version history" block. "Edit note" re-opens
 * the note for editing (the full template / language / edit toolbar), and
 * every saved version of the note is listed here. Each unlock-edit-resign
 * cycle records the per-field before/after delta (via /note/edit + sign), so
 * nothing is lost.
 */
export function RevisionPanel({ sessionId, onUnlock, unlocking }: Props) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);

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

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  return (
    <div className="mt-6 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-[var(--color-ink)]">Version history</h3>
        <button
          type="button"
          onClick={() => void onUnlock()}
          disabled={unlocking}
          className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
        >
          {unlocking ? 'Opening…' : 'Edit note'}
        </button>
      </div>
      <div className="mt-3 border-t border-[var(--color-line-soft)] pt-3">
        {history === null ? (
          <p className="text-xs text-[var(--color-ink-3)]">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-3)]">
            No edits yet — this is the original note. “Edit note” re-opens it; each version you save
            appears here.
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
