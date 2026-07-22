import {
  CarePlanGoalSchema,
  CareTurnSchema,
  type CarePlanGoal,
  type CareSessionKind,
  type CareTurn,
} from '@cureocity/contracts';
import {
  computeInstrumentChange,
  computeInstrumentTrajectory,
  INSTRUMENTS,
  type InstrumentKey,
} from '@cureocity/clinical';
import {
  buildCareTherapistPrompt,
  CARE_PROTOCOL_STEPS,
  CARE_SESSION_CAP_MIN,
} from '@cureocity/llm';
import { z } from 'zod';
import { prisma } from './prisma';
import { CARE_REVIEW_EVERY_N_SESSIONS, inferCareSessionKind } from './care-session-kind';

/**
 * Cureocity Care — the case file (AC4). One assembler feeds BOTH the live
 * session prompt (§4.8) and the Pass 10 report input (§5), so the
 * therapist in the room and the report writer always see the same record.
 * Defensive JSON parsing throughout — a malformed stored row degrades to
 * safe defaults, never a 500 (the clinical-mappers philosophy).
 */

export interface CareInstrumentVerdict {
  instrumentKey: InstrumentKey;
  baselineScore: number;
  latestScore: number;
  verdict: string;
}

/// CP3 — the LATEST measured score + its severity band per instrument (the
/// "where you're starting" read the intake report shows). Present from the
/// first response, unlike verdicts which need two.
export interface CareMeasure {
  instrumentKey: InstrumentKey;
  score: number;
  band: string;
}

export interface CareCaseFile {
  plan: {
    id: string;
    version: number;
    formulation: string;
    goals: CarePlanGoal[];
    modalityTrack: string;
    cadence: string;
  } | null;
  completedCount: number;
  completedSinceCurrentPlan: number;
  completedSinceLastReview?: number;
  treatmentSessionsCompleted: number;
  lastReportSummary?: string;
  homeworkLine?: string;
  recentThemes: string[];
  verdicts: CareInstrumentVerdict[];
  measures: CareMeasure[];
  worseningVerdict: boolean;
}

const GoalsArraySchema = z.array(CarePlanGoalSchema).catch([]);
const TurnsArraySchema = z.array(CareTurnSchema).catch([]);

export async function getCareCaseFile(careUserId: string): Promise<CareCaseFile> {
  const [plan, completedSessions, instrumentRows] = await Promise.all([
    prisma.carePlan.findFirst({
      where: { careUserId },
      orderBy: { version: 'desc' },
    }),
    prisma.careSession.findMany({
      where: { careUserId, status: 'COMPLETED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, kind: true, createdAt: true },
    }),
    prisma.careInstrumentResponse.findMany({
      where: { careUserId },
      orderBy: { createdAt: 'asc' },
      select: { instrumentKey: true, totalScore: true },
    }),
  ]);

  const completedCount = completedSessions.length;
  const completedSinceCurrentPlan = plan
    ? completedSessions.filter((s) => s.createdAt > plan.acceptedAt).length
    : completedCount;
  const lastReviewIdx = completedSessions.map((s) => s.kind).lastIndexOf('REVIEW');
  const completedSinceLastReview =
    lastReviewIdx === -1 ? undefined : completedCount - lastReviewIdx - 1;
  const treatmentSessionsCompleted = completedSessions.filter((s) => s.kind === 'TREATMENT').length;

  // Instrument series → deterministic reliable-change verdicts. Baseline
  // is the FIRST response; the engine (change-score.ts) is the only judge.
  const verdicts: CareInstrumentVerdict[] = [];
  // CP3 — the LATEST score + its severity band per instrument (needs only one
  // response), the "where you're starting" read for the intake report.
  const measures: CareMeasure[] = [];
  // CP-B — a plain baseline-vs-latest verdict misses a client who improved then
  // slipped back (18 → 8 → 16). Track the trajectory too, so a relapse pulls a
  // review forward instead of reading as "no reliable change".
  let recentlyWorsening = false;
  for (const key of ['PHQ9', 'GAD7'] as InstrumentKey[]) {
    const series = instrumentRows.filter((r) => r.instrumentKey === key);
    if (series.length >= 1) {
      const latest = series[series.length - 1]!.totalScore;
      const band = INSTRUMENTS[key].severityBands.find((b) => latest >= b.min && latest <= b.max);
      measures.push({ instrumentKey: key, score: latest, band: band?.label.en ?? '' });
    }
    if (series.length >= 2) {
      const baseline = series[0]!.totalScore;
      const latest = series[series.length - 1]!.totalScore;
      const change = computeInstrumentChange(key, baseline, latest);
      verdicts.push({
        instrumentKey: key,
        baselineScore: baseline,
        latestScore: latest,
        verdict: change.verdict,
      });
      const trajectory = computeInstrumentTrajectory(
        key,
        series.map((s) => s.totalScore),
      );
      if (trajectory?.recentlyWorsening) recentlyWorsening = true;
    }
  }
  const worseningVerdict =
    verdicts.some((v) => v.verdict === 'deterioration') || recentlyWorsening;

  // Last TREATMENT report — feeds LAST TIME / HOMEWORK / themes continuity.
  // Plus the latest INTAKE report as a fallback, so the FIRST treatment
  // session (no treatment report yet) opens on the intake instead of cold.
  const [lastTreatmentReport, recentReports, recentNotes, homeworkTicks, lastIntakeReport] =
    await Promise.all([
      prisma.careReport.findFirst({
        where: { careSession: { careUserId }, kind: 'TREATMENT' },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      }),
      prisma.careReport.findMany({
        where: { careSession: { careUserId }, kind: 'TREATMENT' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { body: true },
      }),
      // CG4 — the daily micro-loop's investment step: the user's own check-in
      // lines flow into the next session's prompt, so being remembered is
      // demonstrable, never fabricated (personalization theater is the named
      // anti-pattern).
      prisma.careCheckin.findMany({
        where: { careUserId, note: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { note: true },
      }),
      prisma.careHomeworkTick.count({
        where: { careUserId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      prisma.careReport.findFirst({
        where: { careSession: { careUserId }, kind: 'INTAKE' },
        orderBy: { createdAt: 'desc' },
        select: { body: true },
      }),
    ]);

  let lastReportSummary: string | undefined;
  let homeworkLine: string | undefined;
  const recentThemes: string[] = [];
  const bodyOf = (b: unknown): Record<string, unknown> =>
    b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
  if (lastTreatmentReport) {
    const sr = bodyOf(bodyOf(lastTreatmentReport.body)['sessionReport']);
    // Lead the continuity line with the warm headline (the emotional
    // through-line) then the detail, so the persona can "start from where we
    // left off" grounded in the last report rather than a cold recap.
    const headline = typeof sr['headline'] === 'string' ? sr['headline'].trim() : '';
    const summary = typeof sr['summary'] === 'string' ? sr['summary'].trim() : '';
    const joined = [headline, summary].filter(Boolean).join(' ');
    if (joined) lastReportSummary = joined;
    const hw = bodyOf(sr['homework']);
    if (typeof hw['title'] === 'string') homeworkLine = hw['title'];
  }
  // CG4 — the tick count rides the homework line into the prompt: "You did
  // the breathing three nights — what did you notice?" is the loop's payoff.
  if (homeworkLine && homeworkTicks > 0) {
    homeworkLine = `${homeworkLine} (done ${homeworkTicks} day${homeworkTicks === 1 ? '' : 's'} this week)`;
  }
  for (const r of recentReports) {
    const sr = bodyOf(bodyOf(r.body)['sessionReport']);
    const insights = Array.isArray(sr['insights']) ? sr['insights'] : [];
    for (const ins of insights as Array<Record<string, unknown>>) {
      if (typeof ins['observation'] !== 'string') continue;
      const observation = ins['observation'];
      // Carry the user's OWN words alongside the pattern — "start from there"
      // means the persona can recall what they actually said, not a summary.
      const quote = typeof ins['evidenceQuote'] === 'string' ? ins['evidenceQuote'].trim() : '';
      recentThemes.push(quote ? `${observation} (they said: "${quote}")` : observation);
    }
  }
  // CG4 — their own check-in words, quoted (the persona opens on these).
  for (const n of recentNotes) {
    if (n.note) recentThemes.unshift(`They wrote on a recent check-in: "${n.note}"`);
  }

  // CP-A (V6) — first treatment session has no TREATMENT report yet; without
  // this it would open cold, exactly like a fresh chat. Carry the INTAKE
  // report's formulation + the user's own concern quotes forward as LAST TIME
  // / themes so session one is grounded in what they told us at intake.
  if (!lastReportSummary && lastIntakeReport) {
    const ap = bodyOf(bodyOf(lastIntakeReport.body)['assessmentAndPlan']);
    const formulation = typeof ap['formulation'] === 'string' ? ap['formulation'].trim() : '';
    if (formulation) lastReportSummary = `From your first session together: ${formulation}`;
    const areas = Array.isArray(ap['concernAreas']) ? ap['concernAreas'] : [];
    for (const a of areas as Array<Record<string, unknown>>) {
      const name = typeof a['name'] === 'string' ? a['name'].trim() : '';
      const quote = typeof a['evidenceQuote'] === 'string' ? a['evidenceQuote'].trim() : '';
      if (name && quote) recentThemes.push(`${name} (they said: "${quote}")`);
      else if (name) recentThemes.push(name);
    }
  }

  return {
    plan: plan
      ? {
          id: plan.id,
          version: plan.version,
          formulation: typeof plan.formulation === 'string' ? plan.formulation : '',
          goals: GoalsArraySchema.parse(plan.goals),
          modalityTrack: plan.modalityTrack,
          cadence: plan.cadence,
        }
      : null,
    completedCount,
    completedSinceCurrentPlan,
    completedSinceLastReview,
    treatmentSessionsCompleted,
    lastReportSummary,
    homeworkLine,
    recentThemes: recentThemes.slice(0, 5),
    verdicts,
    measures,
    worseningVerdict,
  };
}

export function inferKindFromCaseFile(cf: CareCaseFile): CareSessionKind {
  return inferCareSessionKind({
    hasAcceptedPlan: cf.plan !== null,
    completedSinceCurrentPlan: cf.completedSinceCurrentPlan,
    completedSinceLastReview: cf.completedSinceLastReview,
    worseningVerdict: cf.worseningVerdict,
  });
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
};

/// The natural CODE-MIX name for each regional language — how people
/// actually speak conversationally in India (Malayalam → Manglish, …).
const CODE_MIX_NAMES: Record<string, string> = {
  ml: 'Manglish (a natural Malayalam–English mix)',
  hi: 'Hinglish (a natural Hindi–English mix)',
  ta: 'Tanglish (a natural Tamil–English mix)',
  te: 'Tenglish (a natural Telugu–English mix)',
  kn: 'Kanglish (a natural Kannada–English mix)',
  bn: 'Banglish (a natural Bengali–English mix)',
};

export function languageGuidance(preferred: string, spoken: string[]): string {
  const langs = spoken.length > 0 ? spoken : [preferred];
  const nonEnglish = langs.filter((l) => l !== 'en');
  // English-only → plain everyday English.
  if (nonEnglish.length === 0) {
    return 'Speak natural, everyday English — short, simple, warm sentences.';
  }
  // Code-mix-first: any Indian regional language means the CODE-MIXED register
  // people actually speak (Manglish/Hinglish/…), NEVER pure formal regional
  // language and never pure English. Native-audio models default to a stiff,
  // literary register unless steered hard toward real conversational speech.
  const primary = nonEnglish[0]!;
  const primaryName = LANGUAGE_NAMES[primary] ?? primary;
  const mixName = CODE_MIX_NAMES[primary] ?? `a natural ${primaryName}–English mix`;
  return `Speak with them in ${mixName} — the everyday, code-mixed way people actually talk, NOT pure formal ${primaryName} and NOT pure English. Keep the common English words and phrases people naturally use in speech (things like stress, feeling, okay, work, sleep, relax); keep sentences short and simple; pronounce carefully and unhurriedly. Mirror the user — if they lean more English or more ${primaryName}, follow them.`;
}

export interface BuildSessionPromptInput {
  displayName: string;
  personaName: string;
  personaStyle: string;
  preferredLanguage: string;
  spokenLanguages: string[];
  kind: CareSessionKind;
  topic?: string;
  moodBefore?: number;
  caseFile: CareCaseFile;
  /// CP2 (flagged: CARE_LIVE_STRUCTURE) — emit the session-phases block.
  structureEnabled?: boolean;
}

export function buildSessionPrompt(input: BuildSessionPromptInput): {
  prompt: string;
  sessionCapMin: number;
} {
  const capMin = CARE_SESSION_CAP_MIN[input.kind];
  const cf = input.caseFile;
  const goalsLine =
    cf.plan?.goals
      .map(
        (g, i) =>
          `${i + 1}. ${g.goal}${g.status !== 'ACTIVE' ? ` (${g.status.toLowerCase()})` : ''}`,
      )
      .join(' · ') ?? '';
  const track = cf.plan?.modalityTrack ?? 'CBT';
  const steps = CARE_PROTOCOL_STEPS[track] ?? CARE_PROTOCOL_STEPS['CBT']!;
  // CP-D — the arc PROGRESSES and then holds in maintenance; it never loops
  // back to step 1 (which made session 7 replay session 1 — the no-progression
  // property of a chat thread). Index by completed count, capped at the arc's
  // length; past the arc, switch to a maintenance / generalisation framing.
  const stepIdx = cf.treatmentSessionsCompleted;
  const protocolStep =
    stepIdx < steps.length
      ? `Step ${stepIdx + 1} of ${steps.length} in the ${track} arc — ${steps[stepIdx]!}`
      : `The ${steps.length}-step ${track} arc is complete — this is MAINTENANCE & generalisation. Do NOT restart from step 1: consolidate the tools that have helped, apply them to whatever they bring today, rehearse independent use, and watch for relapse signs.`;
  const label = (k: string) => (k === 'PHQ9' ? 'PHQ-9' : k === 'GAD7' ? 'GAD-7' : k);
  const verdictsLine =
    cf.verdicts.length > 0
      ? cf.verdicts
          .map((v) => `${label(v.instrumentKey)} ${v.baselineScore}→${v.latestScore} (${v.verdict})`)
          .join('; ')
      : undefined;
  // CP-A (V6) — the latest measured score + band, so a treatment session that
  // has a baseline but not yet a change verdict can still name where they are.
  const measuresLine =
    cf.measures.length > 0
      ? cf.measures
          .map((m) => `${label(m.instrumentKey)} ${m.score}${m.band ? ` (${m.band})` : ''}`)
          .join('; ')
      : undefined;

  const prompt = buildCareTherapistPrompt({
    kind: input.kind,
    personaName: input.personaName,
    personaStyle: input.personaStyle,
    userFirstName: input.displayName.split(' ')[0] ?? input.displayName,
    languageGuidance: languageGuidance(input.preferredLanguage, input.spokenLanguages),
    sessionCapMin: capMin,
    topic: input.topic,
    moodBefore: input.moodBefore,
    caseFile: {
      sessionNumber: cf.completedCount + 1,
      // CP-A (V6) — pass the FULL working formulation, not a truncated first
      // line, so Meera holds the whole case, not a headline.
      formulation: cf.plan?.formulation ?? '',
      goalsLine,
      lastSummary: cf.lastReportSummary,
      homeworkLine: cf.homeworkLine,
      recentThemes: cf.recentThemes.join(' | ') || undefined,
      protocolStep,
    },
    verdictsLine,
    measuresLine,
    structureEnabled: input.structureEnabled,
  });
  return { prompt, sessionCapMin: capMin };
}

/** Server-mirrored turns → the transcript Pass 10 reads. */
export function stitchTranscript(liveTranscript: unknown): string {
  const turns: CareTurn[] = TurnsArraySchema.parse(liveTranscript);
  return [...turns]
    .sort((a, b) => a.seq - b.seq)
    .map((t) => `${t.role === 'user' ? 'USER' : 'THERAPIST'}: ${t.text}`)
    .join('\n');
}

export function caseFileJsonForReport(
  cf: CareCaseFile,
  moodBefore?: number | null,
  moodAfter?: number | null,
): string {
  return JSON.stringify(
    {
      plan: cf.plan
        ? {
            version: cf.plan.version,
            formulation: cf.plan.formulation,
            goals: cf.plan.goals,
            modalityTrack: cf.plan.modalityTrack,
            cadence: cf.plan.cadence,
          }
        : null,
      completedSessions: cf.completedCount,
      reviewEveryNSessions: CARE_REVIEW_EVERY_N_SESSIONS,
      // CP3 — the measured "where you're starting" read; the INTAKE report
      // copies these into `measures` (it never re-scores them).
      baselineMeasures: cf.measures,
      lastReportSummary: cf.lastReportSummary ?? null,
      homework: cf.homeworkLine ?? null,
      recentThemes: cf.recentThemes,
      moodBefore: moodBefore ?? null,
      moodAfter: moodAfter ?? null,
    },
    null,
    2,
  );
}
