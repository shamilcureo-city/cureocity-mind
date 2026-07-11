'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  CareMeasure,
  ChangeVerdict,
  JourneyActivePlan,
  TreatmentGoalStatus,
} from '@cureocity/contracts';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { AffectCard } from './AffectCard';
import { InstrumentRunner } from './InstrumentRunner';

interface Props {
  measures: CareMeasure[];
  activePlan: JourneyActivePlan | null;
  clientId: string;
  /** Discharged — goals are read-only. */
  disabled: boolean;
}

const VERDICT_LABEL: Record<ChangeVerdict, string> = {
  reliable_improvement: 'Improving',
  no_reliable_change: 'No reliable change',
  deterioration: 'Worsening',
};

const VERDICT_TONE: Record<ChangeVerdict, 'accent' | 'warn' | 'muted'> = {
  reliable_improvement: 'accent',
  no_reliable_change: 'muted',
  deterioration: 'warn',
};

/**
 * Sprint JE3 — Is it working, zone [3] of the Care Engine page.
 *
 * Verdict-first per instrument (the reliable-change verdict is the headline,
 * not the raw score), with a cadence-driven due badge computed by the engine
 * (DUE_NOW / DUE_SOON / ON_TRACK). Below the scores: administer inline, the
 * active plan's goals (per-goal status toggle, moved here from the old
 * JourneyHeader), and the affect-baseline card. One place to answer "is this
 * treatment working?".
 */
export function CareMeasurePanel({ measures, activePlan, clientId, disabled }: Props) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {measures.map((m) => (
          <MeasureCard key={m.instrumentKey} measure={m} />
        ))}
      </div>

      <InstrumentRunner clientId={clientId} />

      {activePlan && activePlan.goals.length > 0 && (
        <Card className="p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
              Plan goals{activePlan.modality ? ` · ${activePlan.modality}` : ''}
            </p>
            <p className="text-xs font-medium text-[var(--color-ink-2)]">
              {goalBreakdown(activePlan.goals)}
            </p>
          </div>
          <ul className="mt-3 space-y-1.5">
            {activePlan.goals.map((g) => (
              <GoalRow
                key={g.index}
                planId={activePlan.id}
                index={g.index}
                description={g.description}
                measure={g.measure}
                status={g.status}
                disabled={disabled}
              />
            ))}
          </ul>
        </Card>
      )}

      <AffectCard clientId={clientId} />
    </div>
  );
}

function MeasureCard({ measure }: { measure: CareMeasure }) {
  const dueTone =
    measure.dueState === 'DUE_NOW' ? 'warn' : measure.dueState === 'DUE_SOON' ? 'accent' : 'muted';
  const hasVerdict = measure.verdict !== null && measure.baselineScore !== null;

  return (
    <div className="rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{measure.label}</p>
        <Badge tone={dueTone}>{measure.dueLabel}</Badge>
      </div>

      {hasVerdict ? (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-lg text-[var(--color-ink)] tabular-nums">
              {measure.baselineScore}
            </span>
            <span aria-hidden className="text-[var(--color-ink-3)]">
              →
            </span>
            <span className="font-mono text-lg text-[var(--color-ink)] tabular-nums">
              {measure.latestScore}
            </span>
            {measure.delta !== null && (
              <span className="text-xs text-[var(--color-ink-3)] tabular-nums">
                ({measure.delta > 0 ? '+' : ''}
                {measure.delta})
              </span>
            )}
            {measure.verdict && (
              <Badge tone={VERDICT_TONE[measure.verdict]} className="ml-auto">
                {VERDICT_LABEL[measure.verdict]}
              </Badge>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {measure.isResponse && (
              <span title="≥50% reduction from baseline — a clinically meaningful response.">
                <Badge tone="accent">Big improvement</Badge>
              </span>
            )}
            {measure.isRemission && (
              <span title="At or below the symptom-free cutoff.">
                <Badge tone="accent">In remission</Badge>
              </span>
            )}
            <span className="text-xs text-[var(--color-ink-3)]">
              {measure.administrationCount} administration
              {measure.administrationCount === 1 ? '' : 's'}
            </span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          {measure.administrationCount === 0
            ? 'No baseline yet — administer once to set a starting point.'
            : 'One more administration gives the first change verdict.'}
        </p>
      )}
    </div>
  );
}

const GOAL_STATUS_LABEL: Record<TreatmentGoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  ACHIEVED: 'Achieved',
};

// Click cycles the status; the order matches a goal's natural lifecycle.
const GOAL_STATUS_CYCLE: Record<TreatmentGoalStatus, TreatmentGoalStatus> = {
  NOT_STARTED: 'IN_PROGRESS',
  IN_PROGRESS: 'ACHIEVED',
  ACHIEVED: 'NOT_STARTED',
};

function GoalRow({
  planId,
  index,
  description,
  measure,
  status,
  disabled,
}: {
  planId: string;
  index: number;
  description: string;
  measure: string;
  status: TreatmentGoalStatus;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<TreatmentGoalStatus>(status);

  async function cycle(): Promise<void> {
    if (disabled || busy) return;
    const next = GOAL_STATUS_CYCLE[optimistic];
    setOptimistic(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/treatment-plans/${planId}/goals/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setOptimistic(status); // revert
        return;
      }
      router.refresh();
    } catch {
      setOptimistic(status);
    } finally {
      setBusy(false);
    }
  }

  const dot =
    optimistic === 'ACHIEVED'
      ? 'bg-[var(--color-accent)]'
      : optimistic === 'IN_PROGRESS'
        ? 'bg-[var(--color-warn)]'
        : 'border border-[var(--color-line)] bg-transparent';

  return (
    <li className="flex items-start gap-2 text-sm">
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={disabled || busy}
        aria-label={`Goal status: ${GOAL_STATUS_LABEL[optimistic]} (click to change)`}
        className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full disabled:cursor-default"
      >
        <span aria-hidden className={`h-3 w-3 rounded-full ${dot}`}>
          {optimistic === 'ACHIEVED' && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3"
            >
              <path d="M5 12l5 5 9-9" />
            </svg>
          )}
        </span>
      </button>
      <span className={optimistic === 'ACHIEVED' ? 'text-[var(--color-ink-3)] line-through' : ''}>
        {description}
        <span className="text-[var(--color-ink-3)]"> · {measure}</span>
        {optimistic !== 'NOT_STARTED' && (
          <span className="ml-1.5 text-xs text-[var(--color-ink-3)]">
            ({GOAL_STATUS_LABEL[optimistic]})
          </span>
        )}
      </span>
    </li>
  );
}

// Plain "N achieved · N in progress · N not started" readout.
function goalBreakdown(goals: { status: TreatmentGoalStatus }[]): string {
  const achieved = goals.filter((g) => g.status === 'ACHIEVED').length;
  const inProgress = goals.filter((g) => g.status === 'IN_PROGRESS').length;
  const notStarted = goals.filter((g) => g.status === 'NOT_STARTED').length;
  return `${achieved} achieved · ${inProgress} in progress · ${notStarted} not started`;
}
