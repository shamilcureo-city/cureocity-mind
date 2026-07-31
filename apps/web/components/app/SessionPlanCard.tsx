'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PrepareSummaryV1 } from '@cureocity/contracts';
import { composeSessionPlan, type SessionPlanStep } from '@/lib/session-plan';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';

/**
 * TE2 — the session plan, shown on the Record screen once a client is picked.
 *
 * Before this, the Record screen showed nothing: the therapist had everything
 * the product knew about the client sitting one tab away, and pressed record
 * anyway. This card puts the four moves of the hour — open with / work on /
 * measure / close — plus the confirmed diagnoses and the carried questions
 * directly above the record button.
 *
 * All read-only. It writes nothing, decides nothing, and adds no new audit
 * surface; `GET /clients/[id]/prepare` is the single (already audited) read,
 * and `composeSessionPlan` is deterministic. The question ticks are local to
 * the screen — an in-room aid, not a record. Persisting "asked" is TE5.
 */

interface Props {
  clientId: string;
}

export function SessionPlanCard({ clientId }: Props) {
  const [data, setData] = useState<PrepareSummaryV1 | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [asked, setAsked] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch(`/api/v1/clients/${clientId}/prepare`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as PrepareSummaryV1);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <Card className="p-5">
        <div className="h-3 w-28 animate-pulse rounded bg-[var(--color-line-soft)]" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-xl bg-[var(--color-line-soft)]" />
          ))}
        </div>
      </Card>
    );
  }

  // A failed prepare read must never block recording — the therapist can
  // always just press record. Offer a retry and get out of the way.
  if (state === 'error' || !data) {
    return (
      <Card className="p-5">
        <p className="text-sm text-[var(--color-ink-2)]">
          Couldn&rsquo;t load this client&rsquo;s session plan.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 text-sm font-medium underline"
        >
          Try again
        </button>
      </Card>
    );
  }

  const plan = composeSessionPlan(data);

  if (plan.isEmpty) {
    return (
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-[var(--color-ink-3)]">
          Session plan
        </p>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          First session with this client — nothing on file yet. The plan fills in from your notes
          after today.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.09em] text-[var(--color-ink-3)]">
            Today&rsquo;s session plan
          </p>
          {plan.briefIsStale ? (
            <Badge tone="warn">Brief predates the last session</Badge>
          ) : (
            <Badge tone="muted">Built from her record</Badge>
          )}
        </div>

        <ol className="mt-4 grid gap-4">
          {plan.steps.map((step, i) => (
            <PlanStepRow key={step.kind} step={step} n={i + 1} />
          ))}
        </ol>
      </Card>

      {data.confirmedDiagnoses.length > 0 && (
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.09em] text-[var(--color-ink-3)]">
            Where the case stands
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.confirmedDiagnoses.map((d) => (
              <Badge key={d.icd11Code} tone={d.isPrimary ? 'accent' : 'default'}>
                {d.icd11Code} {d.icd11Label}
                {d.isPrimary ? ' · primary' : ''}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {plan.questions.length > 0 && (
        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.09em] text-[var(--color-ink-3)]">
              Ask this session
            </p>
            <span className="text-xs text-[var(--color-ink-3)]">
              {asked.size} of {plan.questions.length} asked
            </span>
          </div>
          <ul className="mt-2">
            {plan.questions.map((q, i) => {
              const on = asked.has(i);
              return (
                <li key={`${q.question}-${i}`} className="border-b border-[var(--color-line-soft)] last:border-b-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setAsked((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                    className="flex w-full items-start gap-3 py-2.5 text-left"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-[6px] border text-[11px] text-white ${
                        on
                          ? 'u-ink border-transparent'
                          : 'border-[var(--color-line)] bg-white text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span
                      className={`text-sm ${on ? 'text-[var(--color-ink-3)] line-through' : 'text-[var(--color-ink)]'}`}
                    >
                      {q.question}
                      {q.rationale && (
                        // `no-underline` does not cancel an inherited
                        // line-through — set the property explicitly.
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-3)] [text-decoration:none]">
                          {q.rationale}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

const STEP_TONE: Record<SessionPlanStep['kind'], string> = {
  open: 'u-tile-peri',
  work: 'u-tile-peach',
  measure: 'u-tile-lav',
  close: 'u-tile-mint',
};

function PlanStepRow({ step, n }: { step: SessionPlanStep; n: number }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`u-tile ${STEP_TONE[step.kind]} h-9 w-9 text-sm font-semibold`}>{n}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{step.title}</p>
        {step.detail && (
          <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{step.detail}</p>
        )}
        {step.chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {step.chips.map((c) => (
              <Badge key={c} tone="muted">
                {c}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
