import {
  type ClinicalLocale,
  type InstrumentKey,
  type PatientShareSnapshot,
  type ShareArtefactRef,
  type TherapyScriptV1,
  TherapyScriptV1Schema,
  type TherapyNoteV1,
  TherapyNoteV1Schema,
  type ClinicalTreatmentPlan,
  ClinicalTreatmentPlanSchema,
} from '@cureocity/contracts';
import { INSTRUMENTS } from '@cureocity/clinical';
import { ProgressReportError, buildProgressReport } from './progress-report';
import { prisma } from './prisma';

/**
 * Sprint 15 — Snapshot builders.
 *
 * Given a ShareArtefactRef + the requesting psychologist, fetches
 * the source artefact, verifies tenant ownership, and converts it
 * to a discriminated PatientShareSnapshot for storage on the
 * PatientShare row.
 *
 * Each builder is defensive: cross-tenant requests return null +
 * the route returns 404; malformed source JSON throws a typed
 * SnapshotBuildError the route surfaces as a 422.
 *
 * The therapy-script + treatment-plan snapshots intentionally
 * exclude verbatim therapist-facing language (the script steps, the
 * raw plan justifications) — the patient sees a patient-friendly
 * summary and the actionable homework + goals instead.
 */

export class SnapshotBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotBuildError';
  }
}

interface BuildArgs {
  ref: ShareArtefactRef;
  clientId: string;
  psychologistId: string;
  language: ClinicalLocale;
}

export interface SnapshotResult {
  snapshot: PatientShareSnapshot;
  subject: string;
  sessionId: string | null;
}

export async function buildSnapshot(args: BuildArgs): Promise<SnapshotResult | null> {
  switch (args.ref.artefactType) {
    case 'SIGNED_NOTE':
      return buildSignedNote(args, args.ref.sessionId);
    case 'REFLECTION_QUESTIONS':
      return buildReflectionQuestions(args, args.ref.sessionId, args.ref.questions);
    case 'THERAPY_SCRIPT':
      return buildTherapyScript(args, args.ref.therapyScriptId);
    case 'TREATMENT_PLAN':
      return buildTreatmentPlan(args, args.ref.treatmentPlanId);
    case 'PROGRESS_REPORT':
      return buildProgressReportSnapshot(args, args.ref.clientId);
    case 'INSTRUMENT_CHECKIN':
      return buildInstrumentCheckin(args, args.ref.clientId, args.ref.instrumentKey);
  }
}

/**
 * Sprint 47 — snapshot a PHQ-9 / GAD-7 for self-serve completion.
 *
 * Verifies the client is owned by the requesting therapist, then
 * freezes the instrument's items + scale (in the share language) onto
 * the snapshot so the portal renders the exact validated wording with
 * no clinical-package dependency. The riskItemNumber rides along so
 * the portal can surface crisis resources the moment a self-harm item
 * is endorsed. `completed` starts false; the submit route flips it.
 */
async function buildInstrumentCheckin(
  { clientId, psychologistId, language }: BuildArgs,
  refClientId: string,
  instrumentKey: InstrumentKey,
): Promise<SnapshotResult | null> {
  if (refClientId !== clientId) {
    throw new SnapshotBuildError('Check-in clientId does not match the request clientId.');
  }
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, psychologistId: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== psychologistId || client.deletedAt !== null) {
    return null;
  }
  const def = INSTRUMENTS[instrumentKey];
  if (!def) {
    throw new SnapshotBuildError(`Unknown instrument: ${instrumentKey}`);
  }
  const pick = <T extends { en: string } & Partial<Record<ClinicalLocale, string>>>(m: T): string =>
    m[language] ?? m.en;
  return {
    snapshot: {
      kind: 'INSTRUMENT_CHECKIN',
      instrumentKey,
      title: pick(def.title),
      recallWindow: pick(def.recallWindow),
      items: def.items.map((i) => ({ id: i.id, number: i.number, text: pick(i.text) })),
      scale: def.scale.map((s) => ({ value: s.value, label: pick(s.label) })),
      riskItemNumber: def.riskItemNumber ?? null,
      completed: false,
      completedAt: null,
    },
    subject: 'A quick check-in before our next session',
    sessionId: null,
  };
}

async function buildSignedNote(
  { clientId, psychologistId }: BuildArgs,
  sessionId: string,
): Promise<SnapshotResult | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      scheduledAt: true,
      therapyNote: { select: { content: true } },
    },
  });
  if (!session || session.psychologistId !== psychologistId || session.clientId !== clientId) {
    return null;
  }
  if (!session.therapyNote) {
    throw new SnapshotBuildError('Cannot share an unsigned note. Sign the note first.');
  }
  const parsed = TherapyNoteV1Schema.safeParse(session.therapyNote.content);
  if (!parsed.success) {
    throw new SnapshotBuildError('Signed note failed schema validation; cannot share.');
  }
  const note: TherapyNoteV1 = parsed.data;
  const subject = `Your session note · ${session.scheduledAt.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
  return {
    snapshot: {
      kind: 'SIGNED_NOTE',
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      pdfUrl: null,
    },
    subject,
    sessionId: session.id,
  };
}

async function buildReflectionQuestions(
  { clientId, psychologistId }: BuildArgs,
  sessionId: string,
  questions: string[],
): Promise<SnapshotResult | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, clientId: true, psychologistId: true },
  });
  if (!session || session.psychologistId !== psychologistId || session.clientId !== clientId) {
    return null;
  }
  if (questions.length === 0) {
    throw new SnapshotBuildError('At least one reflection question is required.');
  }
  return {
    snapshot: {
      kind: 'REFLECTION_QUESTIONS',
      questions,
    },
    subject: 'Reflection questions for this week',
    sessionId: session.id,
  };
}

async function buildTherapyScript(
  { clientId, psychologistId, language }: BuildArgs,
  therapyScriptId: string,
): Promise<SnapshotResult | null> {
  const row = await prisma.therapyScript.findUnique({
    where: { id: therapyScriptId },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      therapyName: true,
      body: true,
    },
  });
  if (!row || row.psychologistId !== psychologistId || row.clientId !== clientId) {
    return null;
  }
  const parsed = TherapyScriptV1Schema.safeParse(row.body);
  if (!parsed.success) {
    throw new SnapshotBuildError('Therapy script failed schema validation; cannot share.');
  }
  const script: TherapyScriptV1 = parsed.data;
  const patientSummary = composePatientFriendlyScriptSummary(script, language);
  return {
    snapshot: {
      kind: 'THERAPY_SCRIPT',
      therapyName: script.therapyName,
      patientSummary,
      homework: {
        description: script.homework.description,
        deliveryNotes: script.homework.deliveryNotes,
      },
    },
    subject: `Practice between sessions · ${script.therapyName}`,
    sessionId: null,
  };
}

async function buildTreatmentPlan(
  { clientId, psychologistId }: BuildArgs,
  treatmentPlanId: string,
): Promise<SnapshotResult | null> {
  const row = await prisma.treatmentPlan.findUnique({
    where: { id: treatmentPlanId },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      version: true,
      body: true,
      supersededAt: true,
    },
  });
  if (!row || row.psychologistId !== psychologistId || row.clientId !== clientId) {
    return null;
  }
  if (row.supersededAt !== null) {
    throw new SnapshotBuildError(
      'This treatment plan has been superseded by a newer version. Share the active plan instead.',
    );
  }
  const parsed = ClinicalTreatmentPlanSchema.safeParse(row.body);
  if (!parsed.success) {
    throw new SnapshotBuildError('Treatment plan failed schema validation; cannot share.');
  }
  const plan: ClinicalTreatmentPlan = parsed.data;
  return {
    snapshot: {
      kind: 'TREATMENT_PLAN',
      modality: plan.modality,
      phaseSequence: plan.phaseSequence,
      goals: plan.goals,
      expectedDurationSessions: plan.expectedDurationSessions,
    },
    subject: `Your treatment plan · v${row.version}`,
    sessionId: null,
  };
}

/**
 * Sprint 20 — Progress report snapshot builder. Delegates to the
 * deterministic `buildProgressReport` helper, which composes a
 * plain-language pre→post from the cumulative instrument + plan data
 * (no LLM). Cross-tenant access is already enforced inside the
 * helper; we re-check the artefact's clientId matches the route's
 * clientId so a typo in the request body can't share Client A's
 * data into Client B's PatientShare row.
 */
async function buildProgressReportSnapshot(
  args: BuildArgs,
  refClientId: string,
): Promise<SnapshotResult | null> {
  if (refClientId !== args.clientId) {
    throw new SnapshotBuildError('Progress report clientId does not match the request clientId.');
  }
  try {
    const result = await buildProgressReport({
      clientId: args.clientId,
      psychologistId: args.psychologistId,
    });
    return {
      snapshot: result.snapshot,
      subject: result.subject,
      sessionId: null,
    };
  } catch (e) {
    if (e instanceof ProgressReportError) {
      throw new SnapshotBuildError(e.message);
    }
    throw e;
  }
}

/**
 * Strip therapist-facing instructions out of a TherapyScriptV1 so
 * the patient sees an actionable summary — opening intent, what
 * we'll work on, what to expect, homework. Verbatim therapistSays
 * + listenFor + branches stay therapist-only.
 */
function composePatientFriendlyScriptSummary(
  script: TherapyScriptV1,
  _language: ClinicalLocale,
): string {
  const intro = stripBracketTag(script.openingScript);
  const purposes = script.mainExercise.steps
    .slice(0, 5)
    .map((s) => `• ${stripBracketTag(s.purpose)}`);
  const close = stripBracketTag(script.closingScript);
  return [intro, '', 'What we worked on in session:', ...purposes, '', close].join('\n');
}

/**
 * The mock backend prefixes outputs with "[mock]" so we don't ship
 * tagged content to patients. Strip the marker if present.
 */
function stripBracketTag(s: string): string {
  return s.replace(/^\s*\[[A-Za-z0-9_-]+\]\s*/, '');
}
