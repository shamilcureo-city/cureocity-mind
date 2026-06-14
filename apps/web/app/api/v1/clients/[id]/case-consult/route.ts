import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { CaseConsultV1Schema, type CaseConsultV1 } from '@cureocity/contracts';
import { recordCostInr, recordGeminiCall } from '@cureocity/observability/metrics';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { gatherInputs, serialiseContext } from '@/lib/case-briefing';
import { JourneyError } from '@/lib/journey';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Sprint 52 — Case Consult (Pass 8).
 *
 * GET  /api/v1/clients/[id]/case-consult — returns the cached
 *      consult for the current lastSessionId (cheap, first-paint).
 * POST /api/v1/clients/[id]/case-consult — runs Pass 8 synchronously
 *      against the current cumulative record. Cached per (clientId,
 *      lastSessionId) — a fresh COMPLETED session invalidates the
 *      cache because the route picks the new lastSessionId next time.
 *
 * Synchronous on purpose (no `after()`) so the Vercel-Hobby kill
 * window doesn't truncate the Pass — the Clinical Brief route hit
 * exactly that gotcha. 60s maxDuration matches Pass 5/6.
 *
 * Never patient-shareable: there is no PatientShareArtefactType
 * for this artefact, and the route deliberately returns it as a
 * therapist-only payload.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await ctx.params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const lastSession = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    select: { id: true },
  });
  const lastSessionId = lastSession?.id ?? null;

  const cached = await prisma.caseConsult.findFirst({
    where: { clientId, lastSessionId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, body: true, createdAt: true },
  });
  if (!cached || !cached.body) {
    return NextResponse.json({ consult: null, generatedAt: null });
  }
  const parsed = CaseConsultV1Schema.safeParse(cached.body);
  if (!parsed.success) {
    return NextResponse.json({ consult: null, generatedAt: null });
  }
  return NextResponse.json({
    consult: parsed.data,
    generatedAt: cached.createdAt.toISOString(),
  });
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await ctx.params;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  let inputs;
  try {
    inputs = await gatherInputs(clientId, auth.value.psychologistId);
  } catch (e) {
    if (e instanceof JourneyError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }

  const lastSession = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    select: { id: true },
  });
  const lastSessionId = lastSession?.id ?? null;

  const pendingRow = await prisma.caseConsult.create({
    data: {
      clientId,
      psychologistId: auth.value.psychologistId,
      lastSessionId,
      status: 'PENDING',
    },
    select: { id: true },
  });

  try {
    const router = modelRouter();
    const journeySignalsJson = JSON.stringify({
      stage: inputs.journey.stage,
      nextBestAction: inputs.journey.nextBestAction,
      instrumentChanges: inputs.journey.instrumentChanges,
      activePlan: inputs.journey.activePlan
        ? {
            goalsAchieved: inputs.journey.activePlan.goalsAchieved,
            goalsTotal: inputs.journey.activePlan.goalsTotal,
            modality: inputs.journey.activePlan.modality,
          }
        : null,
      sessionsCompleted: inputs.journey.sessionsCompleted,
      hasSafetyPlan: inputs.hasSafetyPlan,
    });
    const result = await router.pass8({
      clientId,
      // Therapist UI is English-only in V1; ICD-11 codes stay English.
      language: 'en',
      contextText: serialiseContext(inputs),
      journeySignalsJson,
    });

    recordGeminiCall({
      pass: result.callLog.pass,
      status: result.callLog.status,
      region: result.callLog.region,
      durationMs: result.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-8',
      durationLabel: 'case_consult',
      inr: result.callLog.costInr,
    });
    await prisma.geminiCallLog.create({
      data: {
        sessionId: null,
        pass: result.callLog.pass,
        model: result.callLog.model,
        region: result.callLog.region,
        promptVersion: result.callLog.promptVersion,
        inputTokens: result.callLog.inputTokens,
        outputTokens: result.callLog.outputTokens,
        costInr: new Prisma.Decimal(result.callLog.costInr),
        latencyMs: result.callLog.latencyMs,
        status: result.callLog.status,
        ...(result.callLog.errorMessage !== undefined && {
          errorMessage: result.callLog.errorMessage,
        }),
      },
    });

    const consult: CaseConsultV1 = result.output.caseConsult;
    const completed = await prisma.caseConsult.update({
      where: { id: pendingRow.id },
      data: {
        status: 'COMPLETED',
        body: consult as unknown as Prisma.InputJsonValue,
        totalCostInr: new Prisma.Decimal(result.callLog.costInr),
      },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'CASE_CONSULT_GENERATED',
      targetType: 'CaseConsult',
      targetId: completed.id,
      metadata: {
        ...auditMetadataFromRequest(req),
        clientId,
        lastSessionId,
        costInr: result.callLog.costInr,
        latencyMs: result.callLog.latencyMs,
      },
    });

    return NextResponse.json({
      consult,
      generatedAt: completed.createdAt.toISOString(),
    });
  } catch (e) {
    const message = (e as Error).message;
    await prisma.caseConsult.update({
      where: { id: pendingRow.id },
      data: { status: 'FAILED', errorMessage: message },
    });
    console.error(`[case-consult] clientId=${clientId} failed: ${message}`);
    return NextResponse.json({ error: `Pass 8 failed: ${message}` }, { status: 502 });
  }
}
