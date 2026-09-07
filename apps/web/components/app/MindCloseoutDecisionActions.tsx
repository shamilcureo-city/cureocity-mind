'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
}

export function MindCloseoutDecisionActions({
  sessionId,
  steps,
  canShare,
  clinicalReview,
  canReviewClinical = true,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<DecisionStep | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const reviewId = useId();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  function openReview(trigger: HTMLButtonElement) {
    reviewTrigger.current = trigger;
    setReviewOpen(true);
    setReviewLoaded(true);
    requestAnimationFrame(() => {
      // Do not steal focus if the clinician already moved into a field while
      // the panel was opening (including on a busy/mobile render).
      if (document.activeElement === trigger || document.activeElement === document.body)
        reviewHeading.current?.focus();
    });
  }

  async function decide(step: DecisionStep, outcome: 'COMPLETE' | 'SKIPPED'): Promise<void> {
    setBusy(`${step}:${outcome}`);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/mind-closeout`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, outcome }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not save this closeout decision.');
      }
      router.refresh();
      setEditingStep(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pending = (step: DecisionStep) => steps[step] === 'PENDING' || editingStep === step;
  const labels: Record<DecisionStep, string> = {
    clinicalSuggestions: 'Clinical suggestions',
    agreements: 'Agreements or homework',
    nextSessionQuestions: 'Next-session questions',
    shared: 'Client sharing',
  };

  return (
    <div className="mt-4 space-y-4">
      {(Object.keys(labels) as DecisionStep[])
        .filter((step) => (canShare || step !== 'shared') && steps[step] !== 'PENDING')
        .filter(
          (step) =>
            canReviewClinical || !['clinicalSuggestions', 'nextSessionQuestions'].includes(step),
        )
        .map((step) => (
          <div key={step} className="flex items-center justify-between gap-3 text-sm">
            <span>
              {labels[step]} · {steps[step] === 'SKIPPED' ? 'Not needed this session' : 'Recorded'}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => setEditingStep(editingStep === step ? null : step)}
            >
              {steps[step] === 'COMPLETE' && step !== 'clinicalSuggestions' ? 'Review' : 'Change'}
            </Button>
          </div>
        ))}
      {canReviewClinical && pending('clinicalSuggestions') && (
        <DecisionRow label="Clinical suggestions">
          {clinicalReview ? (
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={reviewOpen}
              aria-controls={reviewId}
              onClick={(event) => openReview(event.currentTarget)}
            >
              Review suggestions here
            </Button>
          ) : (
            <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
              Review suggestions
            </Link>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('clinicalSuggestions', 'COMPLETE')}
            disabled={busy !== null}
          >
            Reviewed
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('clinicalSuggestions', 'SKIPPED')}
            disabled={busy !== null}
          >
            Not needed today
          </Button>
        </DecisionRow>
      )}
      {pending('agreements') && (
        <DecisionRow label="Agreements or homework">
          <Link href="#session-agreements" className={styles.contextLink}>
            Add what you agreed
          </Link>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('agreements', 'SKIPPED')}
            disabled={busy !== null || steps.agreements === 'COMPLETE'}
          >
            None this session
          </Button>
        </DecisionRow>
      )}
      {canReviewClinical && pending('nextSessionQuestions') && (
        <DecisionRow label="Next-session questions">
          {clinicalReview ? (
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={reviewOpen}
              aria-controls={reviewId}
              onClick={(event) => openReview(event.currentTarget)}
            >
              Choose questions here
            </Button>
          ) : (
            <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
              Choose questions
            </Link>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('nextSessionQuestions', 'SKIPPED')}
            disabled={busy !== null || steps.nextSessionQuestions === 'COMPLETE'}
          >
            None to carry forward
          </Button>
        </DecisionRow>
      )}
      {canShare && pending('shared') && (
        <DecisionRow label="Client sharing">
          {steps.shared === 'COMPLETE' && (
            <p className="text-sm text-[var(--color-ink-2)]">
              Sharing is already recorded. Review the receipts and client sharing history below to
              manage existing links; a skip decision does not revoke them.
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('shared', 'SKIPPED')}
            disabled={busy !== null || steps.shared === 'COMPLETE'}
          >
            Do not share
          </Button>
        </DecisionRow>
      )}
      {busy && (
        <p role="status" className="text-xs text-[var(--color-ink-3)]">
          Saving your decision…
        </p>
      )}
      {reviewLoaded && clinicalReview && (
        <section
          id={reviewId}
          hidden={!reviewOpen}
          className="space-y-4 rounded-xl border border-[var(--color-line)] bg-white p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold">
              Clinical suggestions and next-session questions
            </h3>
            <Button
              variant="secondary"
              onClick={() => {
                setReviewOpen(false);
                requestAnimationFrame(() => {
                  const active = document.activeElement;
                  if (
                    active === document.body ||
                    document.getElementById(reviewId)?.contains(active)
                  )
                    reviewTrigger.current?.focus();
                });
              }}
            >
              Return to finish checklist
            </Button>
          </div>
          <p className="text-sm text-[var(--color-ink-2)]">
            Review only what is useful. Accepting a suggestion is your clinical decision; opening
            this panel does not mark it reviewed.
          </p>
          {clinicalReview}
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}
    </div>
  );
}

function DecisionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-[var(--color-line-soft)] pt-3 text-sm">
      <span className="font-medium text-[var(--color-ink)]">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
