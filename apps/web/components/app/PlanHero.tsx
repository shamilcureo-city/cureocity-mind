'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { TreatmentGoalStatus } from '@cureocity/contracts';
import { Card } from '../ui/Card';

/**
 * Copilot IA redesign (R2) — the Plan hero.
 *
 * The founder's core complaint: "the plan of psychologist should be there".
 * Before R2 the tab named "Plan & toolkit" rendered a map, diagnosis history,
 * a therapy library, and a "Workflow" form — but NOT the client's actual
 * treatment plan, which had no full in-app view anywhere. This renders it:
 * modality, expected duration, the phase sequence, and every goal with its
 * live achievement status (toggled through the existing goals route, which
 * writes TreatmentGoalProgress without re-versioning the plan).
 *
 * The plan is the therapist's document. The copilot proposes edits from a
 * session's Review board; it never renders a competing plan here.
 */

export interface PlanHeroGoal {
  description: string;
  measure: string;
  status: TreatmentGoalStatus;
}

export interface PlanHeroData {
  id: string;
  version: number;
  modality: string;
  expectedDurationSessions: number | null;
  phaseSequence: string[];
  goals: PlanHeroGoal[];
  confirmedAt: string;
}

interface Props {
  plan: PlanHeroData | null;
  versionCount: number;
  primaryDiagnosis: { icd11Code: string; icd11Label: string } | null;
  /** A session's Review board, where a plan is accepted / edited. */
  reviewHref: string | null;
}

const GOAL_STATUS_LABEL: Record<TreatmentGoalStatus, string> = {
  NOT_STARTED: 'Not started',
  IN_PROGRESS: 'In progress',
  ACHIEVED: 'Achieved',
};
const GOAL_STATUS_CYCLE: Record<TreatmentGoalStatus, TreatmentGoalStatus> = {
  NOT_STARTED: 'IN_PROGRESS',
  IN_PROGRESS: 'ACHIEVED',
  ACHIEVED: 'NOT_STARTED',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function PlanHero({ plan, versionCount, primaryDiagnosis, reviewHref }: Props) {
  if (!plan) {
    return (
      <Card className="p-10 text-center">
        <p className="font-serif text-2xl">No treatment plan yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          A plan is created when you accept one on a session&rsquo;s{' '}
          <span className="font-medium">Review</span> tab. Once it exists, the whole plan — phases,
          goals and progress — lives here, and every future session builds on it.
        </p>
        {reviewHref && (
          <a
            href={reviewHref}
            className="mt-5 inline-flex items-center rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Go to Review →
          </a>
        )}
      </Card>
    );
  }

  const achieved = plan.goals.filter((g) => g.status === 'ACHIEVED').length;
  const inProgress = plan.goals.filter((g) => g.status === 'IN_PROGRESS').length;

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            The working plan
          </p>
          <h2 className="mt-1 font-serif text-2xl capitalize">
            {plan.modality}
            <span className="font-sans text-base font-normal normal-case text-[var(--color-ink-2)]">
              {plan.expectedDurationSessions !== null
                ? ` · ~${plan.expectedDurationSessions} sessions`
                : ''}
            </span>
          </h2>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
            v{plan.version} · confirmed {formatDate(plan.confirmedAt)}
          </span>
          {versionCount > 1 && (
            <p className="mt-1 text-[11px] text-[var(--color-ink-3)]">
              {versionCount} version{versionCount === 1 ? '' : 's'} on record
            </p>
          )}
        </div>
      </div>

      {primaryDiagnosis && (
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Anchored to <span className="font-mono">{primaryDiagnosis.icd11Code}</span>{' '}
          {primaryDiagnosis.icd11Label}
        </p>
      )}

      {/* Plan phases — the intended arc of the work. */}
      <div className="mt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
          Plan phases
        </p>
        <ol className="flex flex-wrap items-center gap-1.5">
          {plan.phaseSequence.map((p, i) => (
            <li key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[var(--color-line)]">—</span>}
              <span className="rounded-full bg-[var(--color-surface-soft)] px-3 py-1 text-xs text-[var(--color-ink-2)]">
                {i + 1}. {p}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Goals — live status; toggling never re-versions the plan. */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-3)]">
            Goals
          </p>
          <p className="text-[11px] text-[var(--color-ink-3)] tabular-nums">
            {achieved} achieved · {inProgress} in progress ·{' '}
            {plan.goals.length - achieved - inProgress} not started
          </p>
        </div>
        <ul className="mt-2 space-y-2">
          {plan.goals.map((g, i) => (
            <GoalRow key={i} planId={plan.id} index={i} goal={g} />
          ))}
        </ul>
        <p className="mt-2.5 text-[11px] text-[var(--color-ink-3)]">
          Click a goal&rsquo;s dot to move it Not started → In progress → Achieved. Progress is read
          by Progress → &ldquo;Is it working?&rdquo; and never rewrites the plan.
        </p>
      </div>
    </Card>
  );
}

function GoalRow({ planId, index, goal }: { planId: string; index: number; goal: PlanHeroGoal }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TreatmentGoalStatus>(goal.status);

  async function cycle(): Promise<void> {
    if (busy) return;
    const next = GOAL_STATUS_CYCLE[status];
    setStatus(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/treatment-plans/${planId}/goals/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setStatus(goal.status);
        return;
      }
      router.refresh();
    } catch {
      setStatus(goal.status);
    } finally {
      setBusy(false);
    }
  }

  const dot =
    status === 'ACHIEVED'
      ? 'bg-[var(--color-accent)] text-white'
      : status === 'IN_PROGRESS'
        ? 'bg-[var(--color-warn)]'
        : 'border-2 border-[var(--color-line)] bg-transparent';

  return (
    <li className="flex items-start gap-3 rounded-xl border border-[var(--color-line-soft)] bg-white/40 p-3">
      <button
        type="button"
        onClick={() => void cycle()}
        disabled={busy}
        aria-label={`Goal status: ${GOAL_STATUS_LABEL[status]} (click to change)`}
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full"
      >
        <span aria-hidden className={`grid h-4 w-4 place-items-center rounded-full ${dot}`}>
          {status === 'ACHIEVED' && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${status === 'ACHIEVED' ? 'text-[var(--color-ink-3)] line-through' : ''}`}
        >
          {goal.description}
        </p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
          {goal.measure} ·{' '}
          <span
            className={
              status === 'ACHIEVED'
                ? 'text-[var(--color-accent)]'
                : status === 'IN_PROGRESS'
                  ? 'text-[var(--color-warn)]'
                  : ''
            }
          >
            {GOAL_STATUS_LABEL[status]}
          </span>
        </p>
      </div>
    </li>
  );
}
