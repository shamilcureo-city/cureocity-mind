import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  type ClinicalLocale,
  ClinicalLocaleSchema,
  type ClinicalTreatmentPlan,
  GenerateTherapyScriptQuerySchema,
} from '@cureocity/contracts';
import {
  recordCostInr,
  recordGeminiCall,
} from '@cureocity/observability/metrics';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toTherapyScript } from '@/lib/clinical-mappers';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/v1/clients/[id]/therapy-scripts?therapy=X[&language=Y][&refresh=1]
 *
 * Returns a Pass 4 TherapyScriptV1 for the named therapy, grounded
 * in the client's current primary diagnosis + active treatment plan
 * + last-session summary. Cached by (clientId, cacheKey) where
 * cacheKey is a SHA-256 hash of the normalised input tuple — a
 * re-view under the same context returns the cached row, no second
 * Vertex bill.
 *
 * Pass refresh=1 to force a fresh generation even if a cached row
 * exists.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const query = parseQuery(req.url, GenerateTherapyScriptQuerySchema);
  if (!query.ok) return query.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      psychologistId: true,
      preferredLanguage: true,
      spokenLanguages: true,
      presentingConcerns: true,
    },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const language: ClinicalLocale =
    query.value.language ??
    (ClinicalLocaleSchema.safeParse(client.preferredLanguage).success
      ? (client.preferredLanguage as ClinicalLocale)
      : 'en');
  // Sprint 16 — the spoken language for verbatim therapistSays text.
  // Defaults to the dominant client.spokenLanguages entry (set by the
  // therapist when creating the client) and falls back to the output
  // language. The therapist reads "therapistSays" aloud to the
  // client, so this needs to match what the client understands.
  const spokenLanguage: ClinicalLocale = pickSpokenLanguage(
    client.spokenLanguages,
    language,
  );

  // Pull grounding context: active primary diagnosis + active plan +
  // last-session summary. None are required; the prompt copes with
  // missing pieces by rendering "(none)" / "(no plan)" / "(first
  // session)".
  const [primaryDx, activePlan, lastSession] = await Promise.all([
    prisma.clientDiagnosis.findFirst({
      where: { clientId, isPrimary: true, supersededAt: null },
      orderBy: { confirmedAt: 'desc' },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
    }),
    prisma.session.findFirst({
      where: { clientId, status: 'COMPLETED', endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
      select: {
        id: true,
        noteDraft: { select: { content: true } },
        therapyNote: { select: { content: true } },
      },
    }),
  ]);

  const planBody = activePlan
    ? (activePlan.body as unknown as ClinicalTreatmentPlan)
    : null;
  const planSummary = planBody
    ? {
        modality: planBody.modality,
        phaseSequence: planBody.phaseSequence,
        goals: planBody.goals,
        expectedDurationSessions: planBody.expectedDurationSessions,
      }
    : null;

  const lastSummary = extractLastSummary(lastSession);

  const cacheKey = computeCacheKey({
    therapy: query.value.therapy,
    language,
    spokenLanguage,
    primaryDx: primaryDx ? `${primaryDx.icd11Code}:${primaryDx.icd11Label}` : null,
    plan: planSummary,
    lastSummary,
  });

  // Cache hit fast path — unless refresh=true.
  if (!query.value.refresh) {
    const cached = await prisma.therapyScript.findUnique({
      where: { clientId_cacheKey: { clientId, cacheKey } },
    });
    if (cached) {
      await writeAudit({
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'THERAPY_SCRIPT_VIEWED',
        targetType: 'TherapyScript',
        targetId: cached.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId,
          therapyName: cached.therapyName,
          language: cached.language,
          source: 'cache',
        },
      });
      return NextResponse.json({ script: toTherapyScript(cached), source: 'cache' });
    }
  }

  // Generate fresh.
  const router = modelRouter();
  const pass4 = await router.pass4({
    therapyName: query.value.therapy,
    language,
    spokenLanguage,
    ...(primaryDx && {
      primaryDiagnosis: {
        icd11Code: primaryDx.icd11Code,
        icd11Label: primaryDx.icd11Label,
      },
    }),
    ...(planSummary && { treatmentPlan: planSummary }),
    ...(lastSummary !== null && { lastSessionSummary: lastSummary }),
    ...(client.presentingConcerns !== null && {
      presentingConcerns: client.presentingConcerns,
    }),
    cacheKeyTrace: cacheKey,
  });

  recordGeminiCall({
    pass: pass4.callLog.pass,
    status: pass4.callLog.status,
    region: pass4.callLog.region,
    durationMs: pass4.callLog.latencyMs,
  });
  recordCostInr({
    service: 'gemini-pass-4',
    durationLabel: 'therapy_script',
    inr: pass4.callLog.costInr,
  });

  await prisma.geminiCallLog.create({
    data: {
      sessionId: null,
      pass: pass4.callLog.pass,
      model: pass4.callLog.model,
      region: pass4.callLog.region,
      promptVersion: pass4.callLog.promptVersion,
      inputTokens: pass4.callLog.inputTokens,
      outputTokens: pass4.callLog.outputTokens,
      costInr: new Prisma.Decimal(pass4.callLog.costInr),
      latencyMs: pass4.callLog.latencyMs,
      status: pass4.callLog.status,
      ...(pass4.callLog.errorMessage !== undefined && {
        errorMessage: pass4.callLog.errorMessage,
      }),
    },
  });

  const row = await prisma.therapyScript.upsert({
    where: { clientId_cacheKey: { clientId, cacheKey } },
    update: {
      body: pass4.output.therapyScript as unknown as Prisma.InputJsonValue,
      therapyName: query.value.therapy,
      language,
      ...(activePlan && { sourceTreatmentPlanId: activePlan.id }),
      ...(primaryDx && { sourcePrimaryDiagnosisId: primaryDx.id }),
      totalCostInr: new Prisma.Decimal(pass4.callLog.costInr),
    },
    create: {
      clientId,
      psychologistId: auth.value.psychologistId,
      therapyName: query.value.therapy,
      language,
      cacheKey,
      body: pass4.output.therapyScript as unknown as Prisma.InputJsonValue,
      ...(activePlan && { sourceTreatmentPlanId: activePlan.id }),
      ...(primaryDx && { sourcePrimaryDiagnosisId: primaryDx.id }),
      totalCostInr: new Prisma.Decimal(pass4.callLog.costInr),
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'THERAPY_SCRIPT_GENERATED',
    targetType: 'TherapyScript',
    targetId: row.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      therapyName: query.value.therapy,
      language,
      cacheKey,
      sourceTreatmentPlanId: activePlan?.id ?? null,
      sourcePrimaryDiagnosisId: primaryDx?.id ?? null,
      costInr: pass4.callLog.costInr,
    },
  });

  return NextResponse.json({ script: toTherapyScript(row), source: 'fresh' });
}

/**
 * GET /api/v1/clients/[id]/therapy-scripts/recommendations
 *
 * Returns the list of therapy names recommended by the active
 * ClinicalReport's `recommendedTherapies` — surfaced as the Therapy
 * Library landing list. Falls back to an empty list if there's no
 * report yet.
 *
 * This is its own export below — Next.js route files share the
 * params shape, so we expose a second handler via a separate route
 * directory.
 */

// ============================================================================
// Helpers.
// ============================================================================

function extractLastSummary(
  session: { noteDraft: { content: unknown } | null; therapyNote: { content: unknown } | null } | null,
): string | null {
  const noteContent = session?.therapyNote?.content ?? session?.noteDraft?.content ?? null;
  if (!noteContent || typeof noteContent !== 'object') return null;
  const note = noteContent as Record<string, unknown>;
  const subjective = typeof note['subjective'] === 'string' ? (note['subjective'] as string) : '';
  const assessment = typeof note['assessment'] === 'string' ? (note['assessment'] as string) : '';
  const plan = typeof note['plan'] === 'string' ? (note['plan'] as string) : '';
  const summary = [
    subjective && `S: ${truncate(subjective, 400)}`,
    assessment && `A: ${truncate(assessment, 400)}`,
    plan && `P: ${truncate(plan, 400)}`,
  ]
    .filter(Boolean)
    .join(' | ');
  return summary || null;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

interface CacheKeyInputs {
  therapy: string;
  language: ClinicalLocale;
  /** Sprint 16 — distinct from `language`; see route comment. */
  spokenLanguage: ClinicalLocale;
  primaryDx: string | null;
  plan: {
    modality: string;
    phaseSequence: string[];
    goals: { description: string; measure: string }[];
    expectedDurationSessions: number | null;
  } | null;
  lastSummary: string | null;
}

/**
 * Pick the verbatim-speech language for Pass 4. Prefer the client's
 * first spokenLanguages entry when it's a known ClinicalLocale;
 * otherwise fall back to the output language. The client's
 * spokenLanguages can include "mixed" or non-ClinicalLocale codes —
 * those fall through to the output language.
 */
function pickSpokenLanguage(
  clientSpoken: string[],
  outputLanguage: ClinicalLocale,
): ClinicalLocale {
  for (const code of clientSpoken) {
    const parsed = ClinicalLocaleSchema.safeParse(code);
    if (parsed.success) return parsed.data;
  }
  return outputLanguage;
}

/**
 * Deterministic cache key. Normalises everything that the prompt
 * actually consumes so unrelated context (e.g. session metadata that
 * doesn't feed the prompt) doesn't fragment the cache.
 *
 * Therapy name and language are normalised to lowercase + trimmed
 * because Pass 4 is case-insensitive for them.
 */
function computeCacheKey(input: CacheKeyInputs): string {
  const normalisedPlan = input.plan
    ? {
        modality: input.plan.modality,
        phaseSequence: input.plan.phaseSequence,
        goals: input.plan.goals.map((g) => ({ d: g.description, m: g.measure })),
        eds: input.plan.expectedDurationSessions,
      }
    : null;
  const payload = JSON.stringify({
    v: 2, // bumped in Sprint 16 — spokenLanguage now affects the script
    t: input.therapy.trim().toLowerCase(),
    l: input.language,
    sl: input.spokenLanguage,
    d: input.primaryDx,
    p: normalisedPlan,
    s: input.lastSummary,
  });
  return createHash('sha256').update(payload).digest('hex');
}
