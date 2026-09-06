'use client';

import { useState } from 'react';
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
}

export function MindCloseoutDecisionActions({ sessionId, steps, canShare }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<DecisionStep | null>(null);

  async function decide(step: DecisionStep, outcome: 'COMPLETE' | 'SKIPPED'): Promise<void> {
    setBusy(`${step}:${outcome}`);
    setError(null);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/mind-closeout`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step, outcome }),
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
      {pending('clinicalSuggestions') && (
        <DecisionRow label="Clinical suggestions">
          <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
            Review suggestions
          </Link>
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
      {pending('nextSessionQuestions') && (
        <DecisionRow label="Next-session questions">
          <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
            Choose questions
          </Link>
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
