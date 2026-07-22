'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';

/**
 * CP-C — "Your plan" (the plan of care, from the user's side).
 *
 * Until now the plan (the formulation + the goals) was seen once, at the
 * accept ceremony, and never again — a stateless chat could produce the same
 * paragraph. This page makes the plan a durable document the user can open:
 * why we think this is happening, what we're working on and how we'll know
 * it's working, and where the measured scores stand. It reuses the existing
 * /api/v1/care/progress route (which already assembles the plan + goals +
 * verdicts) — no new endpoint.
 */

interface PlanGoal {
  goal: string;
  why?: string;
  measure?: string;
  status: string;
}
interface PlanPayload {
  plan: {
    version: number;
    formulation: string;
    goals: PlanGoal[];
    modalityTrack: string;
    cadence: string;
  } | null;
  verdicts: Array<{
    instrumentKey: string;
    baselineScore: number;
    latestScore: number;
    verdict: string;
    plainWords: string;
  }>;
  instrumentSeries: Array<{ instrumentKey: string; totalScore: number }>;
  arc: { track: string; total: number; done: number; complete: boolean } | null;
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  ACTIVE: {
    label: 'Working on it',
    cls: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  },
  ACHIEVED: { label: 'Achieved', cls: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' },
  REVISED: { label: 'Revised', cls: 'bg-[var(--color-surface-soft)] text-[var(--color-ink-3)]' },
};

const TRACK_LABEL: Record<string, string> = {
  CBT: 'Cognitive behavioural therapy (CBT)',
  BEHAVIOURAL_ACTIVATION: 'Behavioural activation',
  GROUNDING: 'Grounding & anxiety skills',
  SLEEP: 'Sleep (CBT-I)',
};

const INSTRUMENT_LABEL: Record<string, string> = {
  PHQ9: 'PHQ-9 · mood',
  GAD7: 'GAD-7 · anxiety',
};

export function CarePlanView() {
  const [data, setData] = useState<PlanPayload | null>(null);

  useEffect(() => {
    void fetch('/api/v1/care/progress')
      .then((r) => r.json())
      .then((d) => setData(d as PlanPayload))
      .catch(() => undefined);
  }, []);

  if (!data) {
    return (
      <div className="mx-auto max-w-md px-5 py-10 text-sm text-[var(--color-ink-3)] md:max-w-2xl md:px-8">
        Loading…
      </div>
    );
  }

  const plan = data.plan;
  const arc = data.arc;

  if (!plan) {
    return (
      <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
        <h1 className="font-serif text-2xl font-semibold md:text-3xl">Your plan</h1>
        <Card className="mt-4 p-5 text-sm text-[var(--color-ink-2)]">
          Your plan appears here after your first session — that&apos;s where you and{' '}
          your therapist agree what you&apos;re working on and how you&apos;ll know it&apos;s
          working.
          <div className="mt-3">
            <Link href="/care/home" className="font-medium text-[var(--color-accent)]">
              Go to your first session →
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-5 py-6 pb-28 md:max-w-2xl md:px-8 md:py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="font-serif text-2xl font-semibold md:text-3xl">Your plan</h1>
        <span className="text-[12px] text-[var(--color-ink-3)]">v{plan.version}</span>
      </div>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">
        How we&apos;re working: <b>{TRACK_LABEL[plan.modalityTrack] ?? plan.modalityTrack}</b> ·{' '}
        {plan.cadence.replace(/-/g, ' · ')}
      </p>

      {plan.formulation ? (
        <Card className="mt-4 p-4 md:p-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            Why we think this is happening
          </span>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{plan.formulation}</p>
          <p className="mt-3 text-[12px] text-[var(--color-ink-3)]">
            A working picture, in plain words — not a diagnosis. It can change as we learn more.
          </p>
        </Card>
      ) : null}

      <Card className="mt-3 p-4 md:p-5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          What we&apos;re working on
        </span>
        {plan.goals.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">No goals set yet.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {plan.goals.map((g, i) => {
              const s = STATUS_STYLE[g.status] ?? STATUS_STYLE.ACTIVE!;
              return (
                <li key={i} className="border-t border-[var(--color-line-soft)] pt-3 first:border-0 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium">
                      {i + 1}. {g.goal}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {g.why ? (
                    <p className="mt-1 text-[13px] text-[var(--color-ink-2)]">{g.why}</p>
                  ) : null}
                  {g.measure ? (
                    <p className="mt-1 text-[12px] text-[var(--color-ink-3)]">
                      How we&apos;ll know: {g.measure}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      {arc ? (
        <Card className="mt-3 p-4 md:p-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            Where you are in the work
          </span>
          <div className="mt-2 flex items-center justify-between text-sm">
            <span>{TRACK_LABEL[arc.track] ?? arc.track}</span>
            <span className="font-semibold">
              {arc.complete ? 'Maintenance' : `Step ${arc.done + 1} of ${arc.total}`}
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: arc.total }).map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded ${i < arc.done ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-soft)]'}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[12px] text-[var(--color-ink-3)]">
            {arc.complete
              ? 'You’ve worked through the core skills — now it’s keeping them and catching dips early.'
              : 'A structured series of skills, roughly one per session — this is where you are in it.'}
          </p>
        </Card>
      ) : null}

      {data.verdicts.length > 0 ? (
        <Card className="mt-3 p-4 md:p-5">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
            The numbers, honestly
          </span>
          <div className="mt-2 space-y-2">
            {data.verdicts.map((v) => (
              <div key={v.instrumentKey}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{INSTRUMENT_LABEL[v.instrumentKey] ?? v.instrumentKey}</span>
                  <span className="font-semibold">
                    {v.baselineScore} → {v.latestScore}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--color-ink-3)]">{v.plainWords}</p>
              </div>
            ))}
          </div>
          <Link
            href="/care/progress"
            className="mt-3 inline-block text-[13px] font-medium text-[var(--color-accent)]"
          >
            See the full trend →
          </Link>
        </Card>
      ) : null}
    </div>
  );
}
