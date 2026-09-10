'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { Button } from '../ui/Button';
import styles from './MindSessionReview.module.css';

type DecisionStep = 'clinicalSuggestions' | 'agreements' | 'nextSessionQuestions' | 'shared';

interface Props {
  sessionId: string;
  steps: MindSessionCloseout['steps'];
  canShare: boolean;
  clinicalReview?: ReactNode;
  canReviewClinical?: boolean;
  initialReviewOpen?: boolean;
}

/** Optional tools, not a second completion ceremony. Opening/closing never writes decisions. */
export function MindCloseoutDecisionActions({
  sessionId,
  steps,
  canShare,
  clinicalReview,
  canReviewClinical = true,
  initialReviewOpen = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(initialReviewOpen);
  const [reviewLoaded, setReviewLoaded] = useState(initialReviewOpen);
  const reviewId = useId();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // A legacy deep link can update this mounted note page. Open the existing
    // support instance without resetting note edits or writing a review decision.
    if (initialReviewOpen) {
      setReviewLoaded(true);
      setReviewOpen(true);
    }
  }, [initialReviewOpen]);

  async function decide(step: DecisionStep, outcome: 'COMPLETE' | 'SKIPPED') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/mind-closeout`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, outcome }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error('Could not save this decision.');
      router.refresh();
    } catch {
      setError('The decision could not be confirmed. Check the saved state, then retry if needed.');
    } finally {
      setBusy(false);
    }
  }

  const labels: Record<DecisionStep, string> = {
    clinicalSuggestions: 'Clinical suggestions',
    agreements: 'Agreements or homework',
    nextSessionQuestions: 'Next-session questions',
    shared: 'Client sharing',
  };

  return (
    <section
      id="session-support"
      className="space-y-4 print:hidden"
      aria-label="Optional session support"
    >
      {canReviewClinical && clinicalReview && (
        <>
          <div className={styles.supportLead}>
            <div>
              <h2>Session support</h2>
              <p>
                Explore evidence, diagnostic suggestions or next-session questions only when useful.
              </p>
            </div>
            <Button
              ref={reviewTrigger}
              variant="secondary"
              aria-expanded={reviewOpen}
              aria-controls={reviewId}
              onClick={() => {
                setReviewLoaded(true);
                setReviewOpen(!reviewOpen);
                if (!reviewOpen) requestAnimationFrame(() => reviewHeading.current?.focus());
              }}
            >
              {reviewOpen ? 'Hide session support' : 'Open session support'}
            </Button>
          </div>
          {reviewLoaded && (
            <section id={reviewId} hidden={!reviewOpen} className={styles.supportBody}>
              <h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">
                Clinical suggestions
              </h3>
              <p className="mt-1 mb-4 text-sm text-[var(--color-ink-2)]">
                Review only what is useful; opening this panel does not mark it reviewed. A
                diagnosis, questionnaire or new plan is not required to finish a counselling
                session.
              </p>
              {clinicalReview}
              <Button
                variant="secondary"
                className="mt-4"
                onClick={() => {
                  setReviewOpen(false);
                  reviewTrigger.current?.focus();
                }}
              >
                Return to the note and next steps
              </Button>
            </section>
          )}
        </>
      )}
      <details className={styles.disclosure}>
        <summary>Optional decision records</summary>
        <div className={`${styles.disclosureBody} space-y-4`}>
          <p className="text-sm text-[var(--color-ink-2)]">
            Use this only to record an explicit decision. Untouched options remain undecided; you do
            not need to select “Not needed” before returning to Today. Skipping sharing does not
            revoke a link.
          </p>
          {(Object.keys(labels) as DecisionStep[])
            .filter(
              (step) =>
                (canShare || step !== 'shared') &&
                (canReviewClinical ||
                  !['clinicalSuggestions', 'nextSessionQuestions'].includes(step)),
            )
            .map((step) => (
              <div
                key={step}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-line-soft)] pt-3 text-sm"
              >
                <span>
                  {labels[step]} ·{' '}
                  {steps[step] === 'PENDING'
                    ? 'No decision recorded'
                    : steps[step] === 'SKIPPED'
                      ? 'Not needed this session'
                      : 'Recorded'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {step === 'clinicalSuggestions' && steps[step] !== 'COMPLETE' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(step, 'COMPLETE')}
                    >
                      Record as reviewed
                    </Button>
                  )}
                  {steps[step] !== 'SKIPPED' &&
                    (steps[step] !== 'COMPLETE' || step === 'clinicalSuggestions') && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide(step, 'SKIPPED')}
                      >
                        {step === 'shared' ? 'Record no sharing' : 'Record not needed'}
                      </Button>
                    )}
                </div>
              </div>
            ))}
          {busy && (
            <p role="status" className="text-sm">
              Saving your decision…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
