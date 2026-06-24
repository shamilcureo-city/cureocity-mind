'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NoteReview } from '@cureocity/contracts';

/**
 * Sprint 68 — record + show supervision reviews on a signed note.
 *
 * Captures that a note was reviewed in supervision (reviewer + optional
 * feedback + date) — useful for trainees logging supervised work. Loads
 * existing reviews and lets the therapist add one. (Full multi-account
 * supervisor routing / co-sign is a larger follow-up.)
 */
export function NoteReviewPanel({ sessionId }: { sessionId: string }) {
  const [reviews, setReviews] = useState<NoteReview[]>([]);
  const [open, setOpen] = useState(false);
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerNote, setReviewerNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/review`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { reviews: NoteReview[] };
      setReviews(data.reviews);
    } catch {
      // non-fatal — panel still lets you add one.
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(): Promise<void> {
    if (reviewerName.trim().length === 0) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/note/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reviewerName: reviewerName.trim(),
          reviewerNote: reviewerNote.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { review?: NoteReview; error?: string };
      if (!res.ok || !data.review) throw new Error(data.error ?? `HTTP ${res.status}`);
      setReviews((xs) => [data.review as NoteReview, ...xs]);
      setReviewerName('');
      setReviewerNote('');
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 border-t border-[var(--color-line-soft)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
          Supervision review
        </p>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-full border border-[var(--color-line)] bg-white px-3 py-1 text-xs font-medium text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
          >
            Record a review
          </button>
        )}
      </div>

      {reviews.length > 0 && (
        <ul className="mt-3 space-y-2">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-[var(--color-line-soft)] bg-white/40 px-3.5 py-2.5 text-sm"
            >
              <p className="text-[var(--color-ink)]">
                Reviewed by <span className="font-medium">{r.reviewerName}</span> ·{' '}
                <span className="text-[var(--color-ink-3)]">
                  {new Date(r.reviewedAt).toLocaleDateString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </p>
              {r.reviewerNote && <p className="mt-1 text-[var(--color-ink-2)]">{r.reviewerNote}</p>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-3 space-y-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3">
          <input
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            placeholder="Reviewer / supervisor name"
            className="w-full rounded-lg border border-[var(--color-line)] bg-white p-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <textarea
            value={reviewerNote}
            onChange={(e) => setReviewerNote(e.target.value)}
            rows={2}
            placeholder="Feedback or notes from supervision (optional)"
            className="w-full rounded-lg border border-[var(--color-line)] bg-white p-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          {error && <p className="text-xs text-[var(--color-warn)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={pending || reviewerName.trim().length === 0}
              className="rounded-full bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending ? 'Saving…' : 'Save review'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
