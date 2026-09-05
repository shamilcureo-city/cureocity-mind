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
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const pending = (step: DecisionStep) => steps[step] === 'PENDING';
  if (
    !pending('clinicalSuggestions') &&
    !pending('agreements') &&
    !pending('nextSessionQuestions') &&
    (!canShare || !pending('shared'))
  ) {
    return (
      <p className="mt-4 text-sm text-[var(--color-accent)]">Your care decisions are saved.</p>
    );
  }

  return (
    <div className="mt-4 space-y-4">
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
          <Link href={`/app/sessions/${sessionId}?tab=review`} className={styles.contextLink}>
            Add what you agreed
          </Link>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('agreements', 'SKIPPED')}
            disabled={busy !== null}
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
            disabled={busy !== null}
          >
            None to carry forward
          </Button>
        </DecisionRow>
      )}
      {canShare && pending('shared') && (
        <DecisionRow label="Client sharing">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void decide('shared', 'SKIPPED')}
            disabled={busy !== null}
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
