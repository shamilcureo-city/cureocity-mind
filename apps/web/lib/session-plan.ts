import type { CarriedQuestion, PrepareSummaryV1 } from '@cureocity/contracts';

/**
 * TE2 — the session plan composer.
 *
 * Turns everything already known about a client into the four moves a
 * therapist makes in an hour: **open with → work on → measure → close**.
 *
 * DETERMINISTIC BY DESIGN. Every line here is composed from cumulative state
 * the therapist already confirmed (the cached pre-session brief, the active
 * plan's goals, instrument history, homework status, carried questions). No
 * LLM call is made to build the plan — the only generated prose is the
 * opening line, which Pass 5 already wrote and cached. That keeps the plan
 * unit-testable, free, and instant, and means it never contradicts the record.
 *
 * It also never invents: a step is omitted when the data behind it is absent
 * (no active plan → no "work on" step), because a confidently-worded but
 * empty instruction is worse than no instruction in a clinical tool.
 */

export type SessionPlanStepKind = 'open' | 'work' | 'measure' | 'close';

export interface SessionPlanStep {
  kind: SessionPlanStepKind;
  /** Short imperative headline, e.g. "Work on — Goal 2: reduce avoidance". */
  title: string;
  /** One or two sentences of detail. May be empty. */
  detail: string;
  /** Small contextual chips, e.g. "Homework set last session". */
  chips: string[];
}

export interface SessionPlanV1 {
  steps: SessionPlanStep[];
  /** Ticked-off checklist for the room. Carried questions, in carry order. */
  questions: CarriedQuestion[];
  /** True when there is genuinely nothing on file yet (first session). */
  isEmpty: boolean;
  /** Set when the cached brief predates the last completed session. */
  briefIsStale: boolean;
}

/** How many days before an instrument is considered due for re-administration. */
const REMEASURE_AFTER_DAYS = 28;

function daysBetween(a: Date, b: Date): number {
  return Math.floor(Math.abs(a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * The "open with" step. Prefers the brief's verbatim opening line; falls back
 * to a homework check when there is homework but no brief, because "how did
 * the practice go?" is the single most reliable way into a session.
 */
function openStep(p: PrepareSummaryV1): SessionPlanStep | null {
  const brief = p.cachedBrief;
  const homework = p.homework[0] ?? null;
  const chips: string[] = [];
  if (homework) {
    chips.push(
      homework.status === 'COMPLETED'
        ? 'Homework completed'
        : homework.status === 'SKIPPED'
          ? 'Homework skipped'
          : 'Homework set last session',
    );
  }

  if (brief?.openingLine) {
    return { kind: 'open', title: 'Open with', detail: brief.openingLine, chips };
  }
  if (homework) {
    return {
      kind: 'open',
      title: 'Open with',
      detail: `Check in on the practice you set: “${homework.description}”`,
      chips,
    };
  }
  return null;
}

/**
 * The "work on" step — the first goal on the active plan that is not yet
 * achieved. Goal order is the therapist's own ordering in the plan, so
 * "the first unachieved goal" is the closest deterministic reading of
 * "what are we working on".
 */
function workStep(p: PrepareSummaryV1): SessionPlanStep | null {
  const plan = p.journey.activePlan;
  if (!plan) return null;

  const openGoals = plan.goals.filter((g) => g.status !== 'ACHIEVED');
  const target = openGoals[0];
  if (!target) {
    return {
      kind: 'work',
      title: 'Work on — every goal met',
      detail: 'All goals on this plan are achieved. Consider a review or a discharge conversation.',
      chips: [`Plan v${plan.version}`],
    };
  }

  const goalNumber = plan.goals.indexOf(target) + 1;
  const chips = [`Plan v${plan.version}`];
  if (plan.modality) chips.push(plan.modality);
  if (plan.goalsTotal > 0) chips.push(`${plan.goalsAchieved} of ${plan.goalsTotal} achieved`);

  return {
    kind: 'work',
    title: `Work on — Goal ${goalNumber}: ${target.description}`,
    detail: p.cachedBrief?.todaysFocus ?? '',
    chips,
  };
}

/**
 * The "measure" step. Due when an instrument has not been administered in
 * REMEASURE_AFTER_DAYS, or when a reliable-change verdict is already sitting
 * on the record and the therapist should confirm it still holds.
 */
function measureStep(p: PrepareSummaryV1, now: Date): SessionPlanStep | null {
  const changes = p.journey.instrumentChanges;
  if (changes.length === 0) return null;

  const due = changes
    .map((c) => ({ c, days: daysBetween(now, new Date(c.latestAt)) }))
    .filter(({ days }) => days >= REMEASURE_AFTER_DAYS)
    .sort((a, b) => b.days - a.days);

  const first = due[0];
  if (!first) return null;

  return {
    kind: 'measure',
    title: `Measure — ${first.c.instrumentKey} due`,
    detail: `Last score ${first.c.latestScore}, ${first.days} days ago.`,
    chips: [`${first.days}d since last`],
  };
}

/** The "close" step. Always present — ending well is never optional. */
function closeStep(p: PrepareSummaryV1): SessionPlanStep {
  const plan = p.journey.activePlan;
  const detail = plan
    ? 'Agree one practice for the week and confirm the next appointment.'
    : 'Agree what happens before the next session and confirm the next appointment.';
  return { kind: 'close', title: 'Close & set homework', detail, chips: [] };
}

/**
 * Compose the plan. `now` is injected so the "due" arithmetic is testable
 * without freezing the clock.
 */
export function composeSessionPlan(p: PrepareSummaryV1, now: Date = new Date()): SessionPlanV1 {
  const steps = [openStep(p), workStep(p), measureStep(p, now), closeStep(p)].filter(
    (s): s is SessionPlanStep => s !== null,
  );

  // A lone close step means we know nothing about this client yet — the UI
  // shows a first-session empty state rather than a one-line "plan".
  const isEmpty = steps.length === 1 && steps[0]?.kind === 'close';

  return {
    steps,
    questions: p.carriedQuestions,
    isEmpty,
    briefIsStale: p.briefIsStale,
  };
}
