import type { JourneySummary } from '@cureocity/contracts';

/**
 * Sprint 22 — Episode-of-Care Stepper.
 *
 * Shows the canonical clinical arc (Intake → Assessment → Formulation
 * & plan → Treatment → Review & outcome) with the client's current
 * stage highlighted. The "flow story" the therapist asked for, made
 * visible at the top of the case workspace.
 *
 * Derived from the Sprint-20 JourneySummary so it always matches what
 * the Journey hub computes — but mapped into the canonical 5 clinical
 * stages (which group ACTIVE_TREATMENT + REVIEW_DUE under "Treatment"
 * and DISCHARGE_READY + DISCHARGED under "Review & outcome").
 *
 * Server component — no hydration cost. Renders as a `<nav>` for a11y.
 */

type StageId = 'intake' | 'assessment' | 'plan' | 'treatment' | 'outcome';

const STAGES: { id: StageId; label: string; sub: string }[] = [
  { id: 'intake', label: 'Intake', sub: 'Record + first history' },
  { id: 'assessment', label: 'Assessment', sub: 'Narrowing the differential' },
  { id: 'plan', label: 'Formulation & plan', sub: 'Confirm dx + plan' },
  { id: 'treatment', label: 'Treatment', sub: 'Deliver the plan' },
  { id: 'outcome', label: 'Review & outcome', sub: 'Re-measure + discharge' },
];

interface Props {
  journey: JourneySummary | null;
  sessionsCompleted: number;
}

export function EpisodeStepper({ journey, sessionsCompleted }: Props) {
  const current = deriveStage(journey, sessionsCompleted);
  const currentIdx = STAGES.findIndex((s) => s.id === current);
  const lastSeen = journey?.lastSessionAt ? formatRelative(journey.lastSessionAt) : null;

  return (
    <nav
      aria-label="Episode of care"
      className="rounded-2xl border border-[var(--color-line-soft)] bg-white/60 p-4"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 text-xs text-[var(--color-ink-3)]">
        <span className="font-semibold uppercase tracking-[0.16em]">Where this client is</span>
        <span>
          {sessionsCompleted} completed session{sessionsCompleted === 1 ? '' : 's'}
          {lastSeen && ` · last seen ${lastSeen}`}
        </span>
      </div>
      <ol className="grid gap-2 sm:grid-cols-5">
        {STAGES.map((s, i) => {
          const state: 'done' | 'current' | 'pending' =
            i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'pending';
          return (
            <li key={s.id} className="relative">
              <div
                className={[
                  'rounded-xl border p-3 transition-colors',
                  state === 'current'
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                    : state === 'done'
                      ? 'border-[var(--color-line)] bg-[var(--color-surface-soft)]'
                      : 'border-dashed border-[var(--color-line-soft)] bg-transparent',
                ].join(' ')}
              >
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={[
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold',
                      state === 'current'
                        ? 'bg-[var(--color-accent)] text-white'
                        : state === 'done'
                          ? 'bg-[var(--color-ink-2)] text-white'
                          : 'border border-[var(--color-line)] text-[var(--color-ink-3)]',
                    ].join(' ')}
                  >
                    {state === 'done' ? '✓' : i + 1}
                  </span>
                  <span
                    className={[
                      'text-sm font-medium',
                      state === 'pending' ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-ink)]',
                    ].join(' ')}
                  >
                    {s.label}
                  </span>
                </div>
                <p
                  className={[
                    'mt-1 text-xs leading-snug',
                    state === 'pending' ? 'text-[var(--color-ink-3)]' : 'text-[var(--color-ink-2)]',
                  ].join(' ')}
                >
                  {s.sub}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function deriveStage(j: JourneySummary | null, sessionsCompleted: number): StageId {
  if (!j || sessionsCompleted === 0) return 'intake';
  if (j.stage === 'INTAKE') return 'intake';
  if (j.stage === 'ASSESSMENT') {
    // A working / confirmed diagnosis on file but no active plan = formulation.
    return j.workingDiagnosis ? 'plan' : 'assessment';
  }
  if (j.stage === 'ACTIVE_TREATMENT' || j.stage === 'REVIEW_DUE') return 'treatment';
  if (j.stage === 'DISCHARGE_READY' || j.stage === 'DISCHARGED') return 'outcome';
  return 'assessment';
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
}
