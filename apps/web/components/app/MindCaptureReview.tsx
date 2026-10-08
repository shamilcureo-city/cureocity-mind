'use client';

import { useEffect, useRef, useState } from 'react';
import type { NoteDraft } from '@cureocity/contracts';
import { Button } from '../ui/Button';

export function mindCaptureNeedsReview(error: string | null | undefined): boolean {
  return (
    error?.split('\n').some((line) => line.startsWith('SCRIBE_CAPTURE_INCOMPLETE_V1:')) === true
  );
}

/** Recovery is tied to the exact displayed source/draft revision, not a generic
 * checkbox that could silently approve a later note. Server signing rechecks. */
export function MindCaptureReview({
  sessionId,
  draft,
  disabled,
  onVerified,
  onReload,
}: {
  sessionId: string;
  draft: NoteDraft;
  disabled: boolean;
  onVerified: (updatedAt: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const [review, setReview] = useState<{
    draftId: string;
    reviewToken: string;
    reviewed: boolean;
  } | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const revisionRef = useRef(0);
  useEffect(() => {
    let current = true;
    revisionRef.current += 1;
    setBusy(false);
    setReview(null);
    setChecked(false);
    setError(null);
    onVerified(null);
    void (async () => {
      try {
        const response = await fetch(`/api/v1/sessions/${sessionId}/capture-review`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Could not verify capture completeness. Please retry.');
        const body = (await response.json()) as {
          draftId: string;
          reviewToken: string;
          draftUpdatedAt: string;
          reviewed: boolean;
        };
        if (body.draftId !== draft.id || body.draftUpdatedAt !== draft.updatedAt)
          throw new Error('The captured note changed. Reload the note before reviewing it.');
        if (current) {
          setReview(body);
          if (body.reviewed) onVerified(draft.updatedAt);
        }
      } catch (error) {
        if (current) setError((error as Error).message);
      }
    })();
    return () => {
      current = false;
      revisionRef.current += 1;
    };
  }, [sessionId, draft.id, draft.updatedAt, attempt, onVerified]);

  async function confirm() {
    if (!review || !checked || disabled || busy || draft.transcript === null) return;
    const revision = revisionRef.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/capture-review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resolution: 'reviewed_and_completed',
          reviewedDraftId: review.draftId,
          reviewToken: review.reviewToken,
          reviewedNote: draft.content,
        }),
      });
      if (revision !== revisionRef.current) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Capture review could not be saved.');
      }
      await onReload();
      if (revision === revisionRef.current) setAttempt((value) => value + 1);
    } catch (error) {
      if (revision === revisionRef.current) {
        setError((error as Error).message);
        setChecked(false);
        onVerified(null);
      }
    } finally {
      if (revision === revisionRef.current) setBusy(false);
    }
  }

  return (
    <section
      role="region"
      aria-label="Incomplete capture review"
      className="mb-5 space-y-3 rounded-xl border border-[var(--color-warn)] bg-[var(--color-warn-soft)] p-5 text-sm"
    >
      <h2 className="font-semibold">Incomplete session capture — review before signing</h2>
      <p>
        The final transcription or note could not be completed. Closing information may be missing.
        Compare the saved words with your session record, then edit and save any missing details. If
        you cannot reconstruct them, leave the note unsigned.
      </p>
      <details open>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Captured words</summary>
        <p className="max-h-60 overflow-auto whitespace-pre-wrap">
          {draft.transcript ?? 'The saved transcript could not be loaded. Reload before reviewing.'}
        </p>
      </details>
      {review?.reviewed ? (
        <p role="status">
          Capture review recorded for this exact draft. Changes require a new review.
        </p>
      ) : (
        <>
          <label className="flex items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={checked}
              disabled={!review || busy || disabled || draft.transcript === null}
              onChange={(event) => setChecked(event.target.checked)}
            />
            I reviewed the captured words and saved corrections for missing information in the note.
          </label>
          <Button
            variant="secondary"
            disabled={
              !checked || !review || busy || disabled || draft.transcript === null || !!error
            }
            onClick={() => void confirm()}
          >
            {busy ? 'Recording review…' : 'Record capture review'}
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {(error || draft.transcript === null) && (
        <Button
          variant="secondary"
          onClick={() => {
            void onReload().then(() => setAttempt((value) => value + 1));
          }}
        >
          Reload note and capture status
        </Button>
      )}
    </section>
  );
}
