'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MindSessionCloseout } from '@cureocity/contracts';
import { Button } from '../ui/Button';

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
    return null;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-[var(--color-line-soft)] pt-4">
      {pending('clinicalSuggestions') && (
        <DecisionRow label="Clinical suggestions">
          <Button
            type="button"
            onClick={() => void decide('clinicalSuggestions', 'COMPLETE')}
            disabled={busy !== null}
          >
            Mark resolved
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void decide('clinicalSuggestions', 'SKIPPED')}
            disabled={busy !== null}
          >
            Skip
          </Button>
        </DecisionRow>
      )}
      {pending('agreements') && (
        <DecisionRow label="Agreements or homework">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void decide('agreements', 'SKIPPED')}
            disabled={busy !== null}
          >
            Intentionally skip
          </Button>
        </DecisionRow>
      )}
      {pending('nextSessionQuestions') && (
        <DecisionRow label="Next-session questions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void decide('nextSessionQuestions', 'SKIPPED')}
            disabled={busy !== null}
          >
            Intentionally skip
          </Button>
        </DecisionRow>
      )}
      {canShare && pending('shared') && (
        <DecisionRow label="Client sharing">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void decide('shared', 'SKIPPED')}
            disabled={busy !== null}
          >
            Do not share
          </Button>
        </DecisionRow>
      )}
      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

function DecisionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-[var(--color-ink-2)]">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
