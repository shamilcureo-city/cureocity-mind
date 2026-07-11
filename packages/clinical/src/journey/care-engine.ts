import type {
  CareAction,
  CareArc,
  CareEngineV1,
  CareGateCriterion,
  CareMeasure,
  CareMeasureDueState,
  CareQuestionRank,
  CareRankedQuestion,
  CareStage,
  CareStageNode,
  CareStageStatus,
  InstrumentChange,
  InstrumentKey,
  JourneyActivePlan,
  JourneyEpisode,
  JourneyWorkingDiagnosis,
} from '@cureocity/contracts';

/**
 * Sprint JE1 — the Care Engine.
 *
 * `computeCareEngine` is a PURE function of the gathered record → a
 * CareEngineV1 (see packages/contracts/src/care-engine.ts for the shape and
 * the design rationale). It is the single rule authority the Journey page
 * renders — replacing the two competing action engines that made "set a
 * baseline" appear four times. Everything is deterministic: same input,
 * same output. No I/O, no clock (the caller passes `now`), no LLM.
 *
 * All thresholds are in CARE_ENGINE_CONSTANTS so a clinician can tune them
 * in one place.
 */

export const CARE_ENGINE_CONSTANTS = {
  /** Instruments tracked for measurement-based care. */
  TRACKED_INSTRUMENTS: ['PHQ9', 'GAD7'] as InstrumentKey[],
  /** Completed sessions since plan confirmation that trigger a review. */
  REVIEW_AT_SESSIONS: 8,
  /** Administrations before a flat trend counts as "not improving". */
  NOT_IMPROVING_MIN_ADMINISTRATIONS: 3,
  /** Days after which a re-measure is due during active treatment. */
  REMEASURE_DUE_DAYS: 14,
  /** Completed sessions an open question survives before it's flagged stale. */
  QUESTION_STALE_AT_SESSIONS: 3,
  /** How many ranked questions the page surfaces up front. */
  TOP_QUESTIONS: 3,
} as const;

const MS_PER_DAY = 86_400_000;

const INSTRUMENT_LABEL: Record<InstrumentKey, string> = {
  PHQ9: 'PHQ-9 · depression',
  GAD7: 'GAD-7 · anxiety',
};

const STAGE_LABEL: Record<CareStage, string> = {
  INTAKE: 'Intake',
  ASSESSMENT: 'Assessment',
  FORMULATION: 'Formulation & plan',
  ACTIVE_TREATMENT: 'Active treatment',
  REVIEW: 'Review & outcome',
};

const STAGE_ORDER: CareStage[] = [
  'INTAKE',
  'ASSESSMENT',
  'FORMULATION',
  'ACTIVE_TREATMENT',
  'REVIEW',
];

// ============================================================================
// Input — a normalised snapshot the app layer assembles (no Prisma, no Date).
// ============================================================================

export interface CareEngineInstrument {
  key: InstrumentKey;
  /** Administrations in the current episode. */
  count: number;
  /** ISO of the latest administration, or null when never administered. */
  lastAt: string | null;
  /** Present when count >= 2 (the reliable-change verdict). */
  change: InstrumentChange | null;
}

export interface CareEngineQuestionInput {
  id: string;
  kind: 'DIAGNOSTIC_CRITERION' | 'ASSESSMENT_GAP' | 'INSTRUMENT' | 'SAFETY';
  question: string;
  rationale: string;
  icd11Code: string | null;
  /** ISO of when the item was created — drives staleness. */
  createdAt: string;
}

export interface CareEngineInput {
  clientId: string;
  /** ISO now — passed in so the engine stays pure (no Date.now()). */
  now: string;
  sessionsCompleted: number;
  lastSessionAt: string | null;
  /** Next booked future SCHEDULED session, if any (ISO). */
  nextSessionAt: string | null;
  /** ISO end-times of completed sessions, newest first — drives staleness. */
  completedSessionEndedAts: string[];
  lastCompletedSessionId: string | null;
  workingDiagnosis: JourneyWorkingDiagnosis | null;
  activePlan: JourneyActivePlan | null;
  /** Completed sessions since the active plan was confirmed. */
  sessionsSincePlan: number;
  instruments: CareEngineInstrument[];
  crisis: {
    highestSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
    labels: string[];
  };
  hasSafetyPlan: boolean;
  discharged: JourneyEpisode | null;
  openQuestions: CareEngineQuestionInput[];
  /** Deep-link base for in-app CTAs (e.g. the session workspace). */
  hrefs: {
    /** The Journey sub-tab of the last completed session (measures live here). */
    journeySub: string | null;
    /** The decision-board ("This session") sub-tab. */
    sessionSub: string | null;
  };
}

// ============================================================================
// The engine.
// ============================================================================

export function computeCareEngine(input: CareEngineInput): CareEngineV1 {
  const facts = deriveFacts(input);
  const queue = buildQueue(input, facts);
  const arc = buildArc(input, facts, queue);
  const measures = buildMeasures(input, facts);
  const questions = buildQuestions(input, facts);
  const cadence = buildCadence(input, facts);

  return {
    version: 'V1',
    clientId: input.clientId,
    arc,
    queue,
    measures,
    questions,
    cadence,
    workingDiagnosis: input.workingDiagnosis,
    activePlan: input.activePlan,
  };
}

// ============================================================================
// Facts — the booleans every downstream builder shares (derived once).
// ============================================================================

interface CareFacts {
  firstSessionDone: boolean;
  hasPrimaryDiagnosis: boolean;
  safetyAddressed: boolean;
  crisisActive: boolean;
  baselineMeasured: boolean;
  hasActivePlan: boolean;
  planStalled: boolean;
  dischargeReady: boolean;
  reviewReached: boolean;
  remeasureDue: boolean;
  isDischarged: boolean;
  currentStage: CareStage;
}

function deriveFacts(input: CareEngineInput): CareFacts {
  const firstSessionDone = input.sessionsCompleted >= 1;
  const hasPrimaryDiagnosis = input.workingDiagnosis !== null;
  const crisisActive =
    input.crisis.highestSeverity === 'high' || input.crisis.highestSeverity === 'critical';
  const safetyAddressed = !crisisActive || input.hasSafetyPlan;
  const baselineMeasured = input.instruments.some((i) => i.count >= 1);
  const hasActivePlan = input.activePlan !== null;

  const planStalled =
    hasActivePlan &&
    input.instruments.some(
      (i) =>
        i.change !== null &&
        i.change.administrationCount >= CARE_ENGINE_CONSTANTS.NOT_IMPROVING_MIN_ADMINISTRATIONS &&
        i.change.verdict !== 'reliable_improvement',
    );

  const dischargeReady = input.instruments.some(
    (i) =>
      i.change !== null &&
      i.change.isRemission &&
      (i.change.verdict === 'reliable_improvement' || i.change.isResponse),
  );

  const reviewReached =
    hasActivePlan &&
    (input.sessionsSincePlan >= CARE_ENGINE_CONSTANTS.REVIEW_AT_SESSIONS || dischargeReady);

  const remeasureDue =
    hasActivePlan &&
    input.instruments.some(
      (i) =>
        i.count >= 1 && daysSince(i.lastAt, input.now) >= CARE_ENGINE_CONSTANTS.REMEASURE_DUE_DAYS,
    );

  const isDischarged = input.discharged !== null;

  const currentStage = deriveStage({
    firstSessionDone,
    assessmentDone: hasPrimaryDiagnosis && safetyAddressed && baselineMeasured,
    hasActivePlan,
    reviewReached,
  });

  return {
    firstSessionDone,
    hasPrimaryDiagnosis,
    safetyAddressed,
    crisisActive,
    baselineMeasured,
    hasActivePlan,
    planStalled,
    dischargeReady,
    reviewReached,
    remeasureDue,
    isDischarged,
    currentStage,
  };
}

function deriveStage(f: {
  firstSessionDone: boolean;
  assessmentDone: boolean;
  hasActivePlan: boolean;
  reviewReached: boolean;
}): CareStage {
  if (!f.firstSessionDone) return 'INTAKE';
  if (!f.assessmentDone) return 'ASSESSMENT';
  if (!f.hasActivePlan) return 'FORMULATION';
  if (f.reviewReached) return 'REVIEW';
  return 'ACTIVE_TREATMENT';
}

// ============================================================================
// The action queue — the single ranked list.
// ============================================================================

const PRIORITY_RANK: Record<CareAction['priority'], number> = {
  SAFETY: 0,
  MEASURE: 1,
  DIAGNOSE: 2,
  PLAN: 3,
  OUTCOME: 4,
};

function buildQueue(input: CareEngineInput, f: CareFacts): CareAction[] {
  // Discharged: the only action is optionally sharing an outcome report.
  if (f.isDischarged) {
    const canShareReport = input.instruments.some((i) => i.change !== null);
    return canShareReport
      ? [
          {
            id: 'share-outcome',
            priority: 'OUTCOME',
            title: 'Share a final outcome report',
            why: 'This episode of care is complete — send the client a record of their progress.',
            unlocks: null,
            when: 'this_session',
            ctaLabel: null,
            ctaHref: null,
          },
        ]
      : [];
  }

  // Pre-first-session: the whole picture is "record the intake".
  if (!f.firstSessionDone) {
    return [
      {
        id: 'record-intake',
        priority: 'DIAGNOSE',
        title: 'Record the intake session',
        why: 'This client has no completed session yet — everything downstream needs the intake first.',
        unlocks: 'Intake · first session',
        when: 'this_session',
        ctaLabel: 'Go to Record',
        ctaHref: '/app',
      },
    ];
  }

  const measuresHref = input.hrefs.journeySub;
  const out: CareAction[] = [];

  // SAFETY — always able to reach #1.
  if (f.crisisActive && !input.hasSafetyPlan) {
    out.push({
      id: 'safety-plan',
      priority: 'SAFETY',
      title: 'Complete a safety plan with the client',
      why: `A ${input.crisis.highestSeverity}-severity crisis flag${input.crisis.labels.length ? ` (${input.crisis.labels.join(', ')})` : ''} is open; risk outranks all other clinical work.`,
      unlocks: 'Assessment gate · Safety addressed',
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // MEASURE — baseline first, then a due re-measure.
  if (!f.baselineMeasured) {
    out.push({
      id: 'baseline',
      priority: 'MEASURE',
      title: 'Administer PHQ-9 + GAD-7',
      why: 'No starting point exists — nothing after this can show change.',
      unlocks: 'Assessment gate · Baseline measured',
      when: 'this_session',
      ctaLabel: 'Administer now',
      ctaHref: measuresHref,
    });
  } else if (f.remeasureDue) {
    out.push({
      id: 'remeasure',
      priority: 'MEASURE',
      title: 'Re-measure PHQ-9 + GAD-7',
      why: `It has been ${CARE_ENGINE_CONSTANTS.REMEASURE_DUE_DAYS}+ days since the last score — a fresh reading keeps the trend live.`,
      unlocks: null,
      when: 'this_session',
      ctaLabel: 'Administer now',
      ctaHref: measuresHref,
    });
  }

  // DIAGNOSE — while still assessing/formulating, surface the top open
  // diagnosis-narrowing question (a provisional working diagnosis doesn't
  // close it; the differential is only resolved when no gating question
  // remains). Exactly ONE question, the highest-value one.
  if (f.currentStage === 'ASSESSMENT' || f.currentStage === 'FORMULATION') {
    const topGating = rankQuestions(input, f).find(
      (q) => q.rank === 'differentiate' || q.rank === 'confirm',
    );
    if (topGating) {
      out.push({
        id: `diagnose:${topGating.id}`,
        priority: 'DIAGNOSE',
        title: `Ask: “${clip(topGating.question, 90)}”`,
        why: `${topGating.rationale} Highest-value of the ${input.openQuestions.length} open question${input.openQuestions.length === 1 ? '' : 's'}.`,
        unlocks: 'carried to next session · in the pre-session brief',
        when: 'next_session',
        ctaLabel: null,
        ctaHref: null,
      });
    } else if (!f.hasPrimaryDiagnosis) {
      out.push({
        id: 'continue-assessment',
        priority: 'DIAGNOSE',
        title: 'Continue the assessment',
        why: 'No diagnosis is accepted yet and no open questions remain — run a session to gather more, then accept from the decision board.',
        unlocks: 'Assessment gate · Working diagnosis',
        when: 'next_session',
        ctaLabel: null,
        ctaHref: null,
      });
    }
  }

  // PLAN — confirm a plan once the assessment gate is met, or review a
  // stalled one. Plan-confirm belongs to the FORMULATION stage (you don't
  // plan before safety + a baseline exist).
  if (f.currentStage === 'FORMULATION') {
    out.push({
      id: 'plan-confirm',
      priority: 'PLAN',
      title: 'Confirm a treatment plan',
      why: 'A working diagnosis is accepted but there is no plan — confirm one so the next sessions have structure.',
      unlocks: 'Formulation gate · Plan accepted',
      when: 'this_session',
      ctaLabel: 'Open the decision board',
      ctaHref: input.hrefs.sessionSub,
    });
  } else if (f.hasActivePlan && f.planStalled) {
    out.push({
      id: 'plan-review',
      priority: 'PLAN',
      title: 'Review the plan — not improving as expected',
      why: 'The screener has shown no reliable improvement across several administrations; an early change of course helps most.',
      unlocks: null,
      when: 'next_session',
      ctaLabel: measuresHref ? 'Get a case consult' : null,
      ctaHref: measuresHref,
    });
  }

  // OUTCOME — discharge when remitted, else book a review.
  if (f.hasActivePlan && f.dischargeReady) {
    out.push({
      id: 'discharge',
      priority: 'OUTCOME',
      title: 'Consider discharge + share an outcome report',
      why: 'The latest screener is in the remission range with a reliable improvement from baseline.',
      unlocks: null,
      when: 'this_session',
      ctaLabel: null,
      ctaHref: null,
    });
  } else if (f.reviewReached && f.hasActivePlan) {
    out.push({
      id: 'book-review',
      priority: 'OUTCOME',
      title: 'Book a plan review',
      why: `The plan has run for ${input.sessionsSincePlan} sessions — review the formulation and outcomes.`,
      unlocks: null,
      when: 'next_session',
      ctaLabel: null,
      ctaHref: null,
    });
  }

  // Stable sort by priority (insertion order preserved within a priority).
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => PRIORITY_RANK[x.a.priority] - PRIORITY_RANK[y.a.priority] || x.i - y.i)
    .map(({ a }) => a);
}

// ============================================================================
// The care arc + the current stage's exit gate.
// ============================================================================

function buildArc(input: CareEngineInput, f: CareFacts, queue: CareAction[]): CareArc {
  const currentIdx = STAGE_ORDER.indexOf(f.currentStage);
  // Resolve a gate criterion to the exact queue action that satisfies it,
  // matching either an exact id or a prefix (diagnose:<itemId> is dynamic).
  const actionId = (want: string): string | null =>
    queue.find((a) => a.id === want || a.id.startsWith(`${want}:`))?.id ?? null;

  const stages: CareStageNode[] = STAGE_ORDER.map((key, idx) => {
    let status: CareStageStatus;
    if (f.isDischarged) status = 'done';
    else if (idx < currentIdx) status = 'done';
    else if (idx === currentIdx) status = 'current';
    else status = 'upcoming';

    const gate =
      !f.isDischarged && status === 'current' ? buildGate(key, input, f, actionId) : null;
    return { key, label: STAGE_LABEL[key], status, gate };
  });

  return {
    stage: f.currentStage,
    stages,
    sessionsCompleted: input.sessionsCompleted,
    lastSessionAt: input.lastSessionAt,
    nextSessionAt: input.nextSessionAt,
    discharged: input.discharged,
    canDischarge: !f.isDischarged && input.sessionsCompleted > 0,
  };
}

function buildGate(
  stage: CareStage,
  input: CareEngineInput,
  f: CareFacts,
  actionId: (want: string) => string | null,
) {
  const criteria: CareGateCriterion[] = [];

  if (stage === 'INTAKE') {
    criteria.push({
      key: 'first-session',
      label: 'First session recorded',
      met: f.firstSessionDone,
      evidence: null,
      why: f.firstSessionDone ? null : 'no completed session yet',
      unlocksActionId: actionId('record-intake'),
    });
  } else if (stage === 'ASSESSMENT') {
    criteria.push({
      key: 'diagnosis',
      label: 'Working diagnosis accepted',
      met: f.hasPrimaryDiagnosis,
      evidence: input.workingDiagnosis
        ? `${input.workingDiagnosis.icd11Code} · accepted ${fmtDay(input.workingDiagnosis.confirmedAt)}`
        : null,
      why: f.hasPrimaryDiagnosis ? null : 'no diagnosis accepted yet',
      unlocksActionId: actionId('diagnose') ?? actionId('continue-assessment'),
    });
    criteria.push({
      key: 'safety',
      label: 'Safety addressed',
      met: f.safetyAddressed,
      evidence: f.safetyAddressed
        ? f.crisisActive
          ? 'safety plan on file'
          : 'no crisis flags'
        : null,
      why: f.safetyAddressed
        ? null
        : `${input.crisis.highestSeverity}-severity flag open, no safety plan on file`,
      unlocksActionId: actionId('safety-plan'),
    });
    criteria.push({
      key: 'baseline',
      label: 'Baseline measured',
      met: f.baselineMeasured,
      evidence: f.baselineMeasured ? 'PHQ-9 / GAD-7 on file' : null,
      why: f.baselineMeasured ? null : 'PHQ-9 + GAD-7 never administered',
      unlocksActionId: actionId('baseline'),
    });
  } else if (stage === 'FORMULATION') {
    criteria.push({
      key: 'plan',
      label: 'Treatment plan accepted',
      met: f.hasActivePlan,
      evidence: input.activePlan ? `plan v${input.activePlan.version}` : null,
      why: f.hasActivePlan ? null : 'diagnosis accepted, no plan yet',
      unlocksActionId: actionId('plan-confirm'),
    });
  } else if (stage === 'ACTIVE_TREATMENT') {
    criteria.push({
      key: 'review-point',
      label: 'Review point',
      met: false,
      evidence: null,
      why: `${input.sessionsSincePlan} of ${CARE_ENGINE_CONSTANTS.REVIEW_AT_SESSIONS} sessions since the plan — keep delivering + re-measuring`,
      unlocksActionId: actionId('remeasure'),
    });
  } else {
    // REVIEW
    criteria.push({
      key: 'outcome',
      label: 'Outcome decided',
      met: false,
      evidence: null,
      why: f.dischargeReady
        ? 'remission reached — discharge or set new goals'
        : 'review the plan against the outcome data',
      unlocksActionId: actionId('discharge') ?? actionId('book-review'),
    });
  }

  const metCount = criteria.filter((c) => c.met).length;
  return {
    label: `To finish ${STAGE_LABEL[stage]}`,
    metCount,
    totalCount: criteria.length,
    criteria,
  };
}

// ============================================================================
// Measures — verdict-first with a due state.
// ============================================================================

function buildMeasures(input: CareEngineInput, f: CareFacts): CareMeasure[] {
  return CARE_ENGINE_CONSTANTS.TRACKED_INSTRUMENTS.map((key) => {
    const inst = input.instruments.find((i) => i.key === key) ?? {
      key,
      count: 0,
      lastAt: null,
      change: null,
    };
    const change = inst.change;
    const hasBaseline = inst.count >= 1;

    let dueState: CareMeasureDueState;
    let dueLabel: string;
    if (inst.count === 0) {
      dueState = 'DUE_NOW';
      dueLabel = 'due now · baseline';
    } else if (inst.count === 1) {
      dueState = 'DUE_SOON';
      dueLabel = 'one more for a verdict';
    } else {
      const days = daysSince(inst.lastAt, input.now);
      const activePhase = f.currentStage === 'ACTIVE_TREATMENT' || f.currentStage === 'REVIEW';
      if (activePhase && days >= CARE_ENGINE_CONSTANTS.REMEASURE_DUE_DAYS) {
        dueState = 'DUE_NOW';
        dueLabel = `re-measure now · last ${days}d ago`;
      } else if (activePhase) {
        dueState = 'ON_TRACK';
        dueLabel = `next in ${Math.max(0, CARE_ENGINE_CONSTANTS.REMEASURE_DUE_DAYS - days)}d`;
      } else {
        dueState = 'ON_TRACK';
        dueLabel = 're-measure once treatment starts';
      }
    }

    return {
      instrumentKey: key,
      label: INSTRUMENT_LABEL[key],
      hasBaseline,
      baselineScore: change?.baselineScore ?? null,
      latestScore: change?.latestScore ?? null,
      delta: change?.delta ?? null,
      verdict: change?.verdict ?? null,
      isResponse: change?.isResponse ?? false,
      isRemission: change?.isRemission ?? false,
      administrationCount: inst.count,
      dueState,
      dueLabel,
    };
  });
}

// ============================================================================
// Questions — ranked by information value; stale + gating counts.
// ============================================================================

const KIND_RANK: Record<CareEngineQuestionInput['kind'], CareQuestionRank> = {
  SAFETY: 'safety',
  ASSESSMENT_GAP: 'differentiate',
  DIAGNOSTIC_CRITERION: 'confirm',
  INSTRUMENT: 'context',
};

const RANK_ORDER: Record<CareQuestionRank, number> = {
  safety: 0,
  differentiate: 1,
  confirm: 2,
  context: 3,
};

function rankQuestions(input: CareEngineInput, _f: CareFacts): CareRankedQuestion[] {
  return input.openQuestions
    .map((q) => {
      const rank = KIND_RANK[q.kind];
      const survived = input.completedSessionEndedAts.filter((t) => t > q.createdAt).length;
      return {
        ranked: {
          id: q.id,
          question: q.question,
          rationale: q.rationale,
          icd11Code: q.icd11Code,
          rank,
          stale: survived >= CARE_ENGINE_CONSTANTS.QUESTION_STALE_AT_SESSIONS,
        } satisfies CareRankedQuestion,
        // Oldest-first within a rank: they've waited longest.
        createdAt: q.createdAt,
      };
    })
    .sort(
      (a, b) =>
        RANK_ORDER[a.ranked.rank] - RANK_ORDER[b.ranked.rank] ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .map((x) => x.ranked);
}

function buildQuestions(input: CareEngineInput, f: CareFacts) {
  const ranked = rankQuestions(input, f);
  const staleCount = ranked.filter((q) => q.stale).length;
  // Questions that narrow the diagnosis (differentiate/confirm). These gate
  // moving from a provisional working diagnosis to a settled one, so they
  // count whether or not a working diagnosis has been accepted.
  const gateCount = ranked.filter((q) => q.rank === 'differentiate' || q.rank === 'confirm').length;
  return {
    top: ranked.slice(0, CARE_ENGINE_CONSTANTS.TOP_QUESTIONS),
    all: ranked,
    openCount: ranked.length,
    staleCount,
    gateCount,
  };
}

// ============================================================================
// Cadence — one interval + reason + a single next-session line.
// ============================================================================

function buildCadence(input: CareEngineInput, f: CareFacts) {
  const latestSeverityKeys = input.instruments
    .map((i) => i.change?.latestSeverityKey)
    .filter((k): k is string => typeof k === 'string');
  const stillSymptomatic = latestSeverityKeys.some(
    (k) => k === 'moderate' || k === 'moderately_severe' || k === 'severe',
  );
  const improving = input.instruments.some((i) => i.change?.verdict === 'reliable_improvement');

  let intervalDays = 7;
  let rationale = 'Weekly contact is standard while the picture is still forming.';
  if (f.currentStage === 'INTAKE' || f.currentStage === 'ASSESSMENT') {
    intervalDays = 7;
    rationale = 'Weekly during assessment keeps the differential narrowing.';
  } else if (improving && !stillSymptomatic) {
    intervalDays = 21;
    rationale = 'Symptoms have eased and are improving — spacing sessions out consolidates gains.';
  } else if (improving) {
    intervalDays = 14;
    rationale = 'Improving but still symptomatic — fortnightly maintains momentum.';
  } else if (stillSymptomatic) {
    intervalDays = 7;
    rationale = 'Symptoms remain moderate or higher — keep weekly contact.';
  }

  const nextSessionLabel = input.nextSessionAt
    ? `booked for ${fmtDay(input.nextSessionAt)}`
    : `recommend in ~${intervalDays} days`;

  return { recommendedIntervalDays: intervalDays, rationale, nextSessionLabel };
}

// ============================================================================
// Small pure helpers.
// ============================================================================

function daysSince(isoThen: string | null, isoNow: string): number {
  if (!isoThen) return Infinity;
  const then = Date.parse(isoThen);
  const now = Date.parse(isoNow);
  if (Number.isNaN(then) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.floor((now - then) / MS_PER_DAY));
}

function fmtDay(iso: string): string {
  // Deterministic UTC day (e.g. "11 Jul"); the UI can re-localise if it wants.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
