'use client';

import { useState } from 'react';
import type { CarriedQuestion, PrepareSummaryV1 } from '@cureocity/contracts';
import type { SessionPlanStep } from '@/lib/session-plan';
import { Badge } from '../ui/Badge';

/**
 * TE2 — the shared direction primitives.
 *
 * ONE rendering of each idea, used by every surface that shows it:
 *
 *   - Today → PreparePanel     (before the client arrives)
 *   - LiveRecorder             (in the room, batch capture)
 *
 * The first attempt at this work added a second, differently-shaped prepare
 * card on the Record screen, so the same carried questions rendered three
 * ways across the product. These components exist so that cannot happen
 * again: if the checklist changes, it changes everywhere.
 *
 * All three are presentational and stateless apart from the tick state,
 * which is deliberately local — an in-room aid, not a record. Persisting
 * "asked" belongs with the note-time reconciliation (TE5).
 */

const STEP_TONE: Record<SessionPlanStep['kind'], string> = {
  open: 'u-tile-peri',
  work: 'u-tile-peach',
  measure: 'u-tile-lav',
  close: 'u-tile-mint',
};

/** The four moves of the hour, numbered. */
export function PlanSpine({ steps }: { steps: SessionPlanStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="grid max-w-[46rem] gap-3.5">
      {steps.map((step, i) => (
        <li key={step.kind} className="flex items-start gap-3">
          <span className={`u-tile ${STEP_TONE[step.kind]} h-8 w-8 text-xs font-semibold`}>
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{step.title}</p>
            {step.detail && (
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-ink-2)]">
                {step.detail}
              </p>
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
      ))}
    </ol>
  );
}

/** Active confirmed diagnoses, primary first. */
export function DiagnosisChips({
  diagnoses,
}: {
  diagnoses: PrepareSummaryV1['confirmedDiagnoses'];
}) {
  if (diagnoses.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {diagnoses.map((d) => (
        <Badge key={d.icd11Code} tone={d.isPrimary ? 'accent' : 'default'}>
          {d.icd11Code} {d.icd11Label}
          {d.isPrimary ? ' · primary' : ''}
        </Badge>
      ))}
    </div>
  );
}

/**
 * The carried questions, tickable. Ticks are local screen state so a
 * therapist can keep their place mid-session; nothing is written.
 */
export function QuestionsChecklist({ questions }: { questions: CarriedQuestion[] }) {
  const [asked, setAsked] = useState<Set<number>>(new Set());
  if (questions.length === 0) return null;

  return (
    <div className="max-w-[46rem]">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Carried questions
        </p>
        <span className="text-xs text-[var(--color-ink-3)]">
          {asked.size} of {questions.length} asked
        </span>
      </div>
      <ul>
        {questions.map((q, i) => {
          const on = asked.has(i);
          return (
            <li
              key={`${q.question}-${i}`}
              className="border-b border-[var(--color-line-soft)] last:border-b-0"
            >
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
                className="flex w-full items-start gap-3 py-2 text-left"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-[6px] border text-[11px] ${
                    on
                      ? 'u-ink border-transparent text-white'
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
                    // `no-underline` does not cancel an inherited line-through.
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
    </div>
  );
}
