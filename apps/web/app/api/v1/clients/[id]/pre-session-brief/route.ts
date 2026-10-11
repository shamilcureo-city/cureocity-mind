import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { ClinicalLocaleSchema, GeneratePreSessionBriefQuerySchema } from '@cureocity/contracts';
import { recordCostInr, recordGeminiCall } from '@cureocity/observability/metrics';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toPreSessionBrief } from '@/lib/clinical-mappers';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { parseQuery } from '@/lib/validate';
import { privateJson, privateResponse } from '@/lib/private-response';
import {
  briefMatchesContext,
  loadPreSessionBriefContext,
  withBriefContext,
} from '@/lib/pre-session-brief-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** GET only reads a saved brief. Explicit POST generates against current clinical context. */
async function handle(req: NextRequest, { params }: Context, allowGeneration: boolean) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST')
    return privateJson({ error: 'Not found' }, { status: 404 });
  const { id: clientId } = await params;
  const query = parseQuery(req.url, GeneratePreSessionBriefQuerySchema);
  if (!query.ok) return privateResponse(query.response);
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, preferredLanguage: true, deletedAt: true },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null)
    return privateJson({ error: 'Client not found' }, { status: 404 });
  const language =
    query.value.language ?? ClinicalLocaleSchema.safeParse(client.preferredLanguage).data ?? 'en';
  const context = await loadPreSessionBriefContext(clientId, auth.value.psychologistId, language);
  const { lastSessionId, fingerprint } = context;

  if (!allowGeneration || !query.value.refresh) {
    const cached = await prisma.preSessionBrief.findFirst({
      where: { clientId, psychologistId: auth.value.psychologistId, language, status: 'COMPLETED' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (cached) {
      const stale =
        cached.lastSessionId !== lastSessionId || !briefMatchesContext(cached.body, fingerprint);
      // Reads may show historical context, explicitly stale; POST never reuses it.
      if (!allowGeneration || !stale) {
        await writeAudit({
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PRE_SESSION_BRIEF_VIEWED',
          targetType: 'PreSessionBrief',
          targetId: cached.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId,
            lastSessionId,
            language,
            source: 'cache',
            stale,
          },
        });
        return privateJson({ brief: toPreSessionBrief(cached), source: 'cache', stale });
      }
    }
  }
  if (!allowGeneration)
    return privateJson(
      {
        error: 'No saved brief yet. Choose Prepare brief to generate one.',
        code: 'PRE_SESSION_BRIEF_NOT_CACHED',
      },
      { status: 404 },
    );

  const briefRow = await prisma.preSessionBrief.create({
    data: {
      clientId,
      psychologistId: auth.value.psychologistId,
      lastSessionId,
      language,
      status: 'PENDING',
    },
  });
  try {
    const pass5 = await modelRouter().pass5(context.input);
    recordGeminiCall({
      pass: pass5.callLog.pass,
      status: pass5.callLog.status,
      region: pass5.callLog.region,
      durationMs: pass5.callLog.latencyMs,
    });
    recordCostInr({
      service: 'gemini-pass-5',
      durationLabel: 'pre_session_brief',
      inr: pass5.callLog.costInr,
    });
    await prisma.geminiCallLog.create({
      data: {
        sessionId: null,
        pass: pass5.callLog.pass,
        model: pass5.callLog.model,
        region: pass5.callLog.region,
        promptVersion: pass5.callLog.promptVersion,
        inputTokens: pass5.callLog.inputTokens,
        outputTokens: pass5.callLog.outputTokens,
        costInr: new Prisma.Decimal(pass5.callLog.costInr),
        latencyMs: pass5.callLog.latencyMs,
        status: pass5.callLog.status,
        ...(pass5.callLog.errorMessage !== undefined && {
          errorMessage: pass5.callLog.errorMessage,
        }),
      },
    });
    // These facts come from the same source snapshot as the prompt/fingerprint.
    const briefBody = withBriefContext(
      {
        ...pass5.output.preSessionBrief,
        homeworkStatus: context.homeworkStatus,
        carryoverCrisis: context.input.openCrises ?? [],
      },
      fingerprint,
    );
    const completed = await prisma.preSessionBrief.update({
      where: { id: briefRow.id },
      data: {
        status: 'COMPLETED',
        body: briefBody as unknown as Prisma.InputJsonValue,
        totalCostInr: new Prisma.Decimal(pass5.callLog.costInr),
      },
    });
    await writeAudit({
      actorType: 'SYSTEM',
      action: 'PRE_SESSION_BRIEF_GENERATED',
      targetType: 'PreSessionBrief',
      targetId: completed.id,
      metadata: {
        clientId,
        lastSessionId,
        language,
        carryoverCrisisCount: briefBody.carryoverCrisis.length,
        costInr: pass5.callLog.costInr,
      },
    });
    // A concurrent clinical edit must not make the just-generated result look current.
    let currentFingerprint: string | null = null;
    try {
      currentFingerprint = (
        await loadPreSessionBriefContext(clientId, auth.value.psychologistId, language)
      ).fingerprint;
    } catch {
      /* Unknown freshness is stale. */
    }
    return privateJson({
      brief: toPreSessionBrief(completed),
      source: 'fresh',
      stale: !briefMatchesContext(briefBody, currentFingerprint),
    });
  } catch (e) {
    await prisma.preSessionBrief.update({
      where: { id: briefRow.id },
      data: { status: 'FAILED', errorMessage: (e as Error).message },
    });
    console.error('[pre-session-brief] generation failed');
    return privateJson(
      { error: 'The brief couldn’t be generated just now. Tap Regenerate to retry.' },
      { status: 502 },
    );
  }
}

export async function GET(req: NextRequest, context: Context): Promise<NextResponse> {
  return handle(req, context, false);
}
export async function POST(req: NextRequest, context: Context): Promise<NextResponse> {
  return handle(req, context, true);
}
