import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  CarriedQuestionSchema,
  ClinicalTreatmentPlanSchema,
  type ClinicalLocale,
  type PreSessionBriefV1,
} from '@cureocity/contracts';
import type { Pass5Input } from '@cureocity/llm';
import { gatherInputs, serialiseContext } from './case-briefing';
import { fetchOpenCrises } from './crisis-flags';
import { summarizeMindSessionNote } from './mind-session-note-summary';
import { prisma } from './prisma';

const CONTEXT_VERSION = 1;
const METADATA_KEY = '_mindBriefContext';
const ContextMetadataSchema = z.object({
  version: z.literal(CONTEXT_VERSION),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Private metadata lives in the existing JSON body; DTO schemas strip it on disclosure. */
export function withBriefContext(body: PreSessionBriefV1, fingerprint: string | null) {
  return {
    ...body,
    [METADATA_KEY]: fingerprint ? { version: CONTEXT_VERSION, fingerprint } : null,
  };
}

export function briefMatchesContext(body: unknown, fingerprint: string | null): boolean {
  if (!fingerprint || !body || typeof body !== 'object') return false;
  const saved = ContextMetadataSchema.safeParse((body as Record<string, unknown>)[METADATA_KEY]);
  // Old briefs cannot prove freshness; keep them visible with an explicit stale warning.
  return saved.success && saved.data.fingerprint === fingerprint;
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  return value;
}

export function briefContextFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue({ version: CONTEXT_VERSION, context: value })))
    .digest('hex');
}

/**
 * One read-only snapshot builder for generation and freshness checks. No model
 * is invoked here. The fingerprint covers the exact prompt inputs, deterministic
 * homework overlay, plan identity and full canonical note (including edits past
 * the summary's clipping boundary). Clinical text is never put in cache metadata.
 */
export async function loadPreSessionBriefContext(
  clientId: string,
  psychologistId: string,
  language: ClinicalLocale,
) {
  const owner = { clientId, psychologistId };
  const [
    client,
    lastSession,
    primaryDx,
    activePlan,
    sessionsSoFar,
    openCrises,
    latestInstruments,
    latestHomework,
  ] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, psychologistId, deletedAt: null },
      select: { presentingConcerns: true, carriedQuestions: true, preferredLanguage: true },
    }),
    prisma.session.findFirst({
      where: { ...owner, status: 'COMPLETED' },
      orderBy: [
        { endedAt: { sort: 'desc', nulls: 'last' } },
        { scheduledAt: 'desc' },
        { id: 'desc' },
      ],
      select: {
        id: true,
        kind: true,
        noteDraft: { select: { content: true } },
        therapyNote: { select: { content: true } },
      },
    }),
    prisma.clientDiagnosis.findFirst({
      where: { ...owner, isPrimary: true, supersededAt: null },
      orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.treatmentPlan.findFirst({
      where: { ...owner, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.session.count({ where: { ...owner, status: 'COMPLETED' } }),
    fetchOpenCrises(clientId),
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: [{ administeredAt: 'desc' }, { id: 'desc' }],
      take: 6,
    }),
    prisma.exerciseAssignment.findFirst({
      where: owner,
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        status: true,
        customDescription: true,
        therapistNote: true,
        exerciseId: true,
        response: true,
      },
    }),
  ]);
  if (!client) throw new Error('Brief context unavailable');

  let caseDigest: string | undefined;
  let completeContext = true;
  try {
    caseDigest = serialiseContext(await gatherInputs(clientId, psychologistId));
  } catch {
    // A degraded generation is still useful, but cannot be labelled current.
    completeContext = false;
  }
  const carriedQuestions =
    z.array(CarriedQuestionSchema).safeParse(client.carriedQuestions).data ?? [];
  if (carriedQuestions.length > 0) {
    const block = [
      'QUESTIONS THE THERAPIST MARKED TO ASK AT THIS SESSION (weave these into todaysFocus and openingLine):',
      ...carriedQuestions.map(
        (q, i) => `${i + 1}. ${q.question}${q.rationale ? ` — why: ${q.rationale}` : ''}`,
      ),
    ].join('\n');
    caseDigest = caseDigest ? `${caseDigest}\n\n${block}` : block;
  }

  const plan = activePlan ? ClinicalTreatmentPlanSchema.parse(activePlan.body) : null;
  const lastSummary = summarizeMindSessionNote(lastSession, 300);
  const input: Pass5Input = {
    clientId,
    language,
    sessionNumber: sessionsSoFar + 1,
    ...(primaryDx && {
      primaryDiagnosis: { icd11Code: primaryDx.icd11Code, icd11Label: primaryDx.icd11Label },
    }),
    ...(plan && {
      treatmentPlan: {
        modality: plan.modality,
        phaseSequence: plan.phaseSequence,
        goals: plan.goals,
        expectedDurationSessions: plan.expectedDurationSessions,
        sessionsSoFar,
      },
    }),
    ...(lastSummary && { lastSessionSummary: lastSummary }),
    ...(caseDigest && { caseDigest }),
    ...(client.presentingConcerns !== null && { presentingConcerns: client.presentingConcerns }),
    openCrises: openCrises.map((c) => ({
      kind: c.kind,
      severity: c.severity,
      lastSeenAt: c.lastSeenAt,
    })),
    latestInstruments: latestInstruments.map((i) => ({
      instrumentKey: i.instrumentKey,
      score: i.score,
      severity: i.severity,
      administeredAt: i.administeredAt.toISOString(),
    })),
  };
  const homeworkStatus: PreSessionBriefV1['homeworkStatus'] = latestHomework
    ? {
        description:
          latestHomework.customDescription?.trim() ||
          latestHomework.therapistNote?.trim() ||
          latestHomework.exerciseId ||
          'Homework',
        outcome:
          latestHomework.status === 'COMPLETED'
            ? 'completed'
            : latestHomework.status === 'IN_PROGRESS'
              ? 'partial'
              : latestHomework.status === 'SKIPPED' || latestHomework.status === 'EXPIRED'
                ? 'skipped'
                : 'unknown',
        notes: null,
      }
    : null;
  const lastSessionId = lastSession?.id ?? null;
  return {
    input,
    lastSessionId,
    homeworkStatus,
    fingerprint: completeContext
      ? briefContextFingerprint({
          input,
          homework: latestHomework,
          lastSessionId,
          canonicalNote:
            lastSession?.therapyNote?.content ?? lastSession?.noteDraft?.content ?? null,
          planId: activePlan?.id ?? null,
          preferredLanguage: client.preferredLanguage,
        })
      : null,
  };
}
