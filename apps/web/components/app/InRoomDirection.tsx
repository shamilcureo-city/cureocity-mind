'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PrepareSummaryV1 } from '@cureocity/contracts';
import { composeSessionPlan } from '@/lib/session-plan';
import { PlanSpine, QuestionsChecklist } from './SessionDirection';

/**
 * TE2 — direction during a BATCH recording.
 *
 * The live-scribe path already has the copilot rail (PASS_12: risk watch,
 * ask-next, threads, session arc). The batch path — a phone on the table,
 * note written afterwards — had nothing, which is the flow most pilot
 * therapists actually use. This fills that gap and only that gap: it never
 * renders on the live path, so the two never stack.
 *
 * Deliberately quiet:
 *   - Collapsed by default. A recording screen should be a recording screen;
 *     direction is there when reached for, not competing with the timer.
 *   - Fetches only on first open, so a therapist who never opens it costs
 *     nothing.
 *   - Read-only. No writes, no new audit surface, and a failed read degrades
 *     to a single line rather than interrupting a live recording.
 */

interface Props {
  clientId: string;
}

export function InRoomDirection({ clientId }: Props) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PrepareSummaryV1 | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/prepare`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as PrepareSummaryV1);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [clientId]);

  useEffect(() => {
    if (open && state === 'idle') void load();
  }, [open, state, load]);

  const plan = data ? composeSessionPlan(data) : null;
  const count = (plan?.questions.length ?? 0) + (plan?.steps.length ?? 0);

  return (
    <div className="border-t border-[var(--color-line-soft)] px-6 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Direction
        {!open && count > 0 && (
          <span className="font-normal normal-case tracking-normal text-[var(--color-ink-3)]">
            · plan &amp; carried questions
          </span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {state === 'loading' && <p className="text-sm text-[var(--color-ink-3)]">Loading…</p>}
          {state === 'error' && (
            <p className="text-sm text-[var(--color-ink-3)]">
              Couldn&rsquo;t load the plan.{' '}
              <button type="button" onClick={() => void load()} className="underline">
                Retry
              </button>
            </p>
          )}
          {plan && !plan.isEmpty && <PlanSpine steps={plan.steps} />}
          {plan?.isEmpty && (
            <p className="text-sm text-[var(--color-ink-3)]">
              First session — nothing on file yet.
            </p>
          )}
          {plan && <QuestionsChecklist questions={plan.questions} />}
        </div>
      )}
    </div>
  );
}
