import { NextResponse, type NextRequest } from 'next/server';
import { ConceptualMapV1Schema, type ConceptualMapV1 } from '@cureocity/contracts';
import { recordGeminiCall } from '@cureocity/observability';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { modelRouter } from '@/lib/llm';
import { prisma } from '@/lib/prisma';
import { buildConceptualMapContext } from '@/lib/conceptual-map';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Pass 7 reads every transcript the client has — large context + LLM
// generation time. 120s budget matches Pass 3's on-demand re-run.
export const maxDuration = 120;

/**
 * GET  /api/v1/clients/[id]/conceptual-map — returns the latest persisted
 *      ConceptualMapV1 for this client (the live row, supersededAt = null).
 *      Empty payload (`map: null`) if the therapist hasn't generated one yet.
 *
 * POST /api/v1/clients/[id]/conceptual-map — runs Pass 7, supersedes the
 *      previous map row, persists the new one, audits, returns it. Failure
 *      leaves the previous live map intact.
 *
 * Sprint 24 — Klarify-style per-client thematic graph. See
 * `apps/web/components/app/ConceptualMapTab.tsx` for the consumer.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const owned = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const row = await prisma.clientConceptualMap.findFirst({
    where: { clientId, psychologistId: auth.value.psychologistId, supersededAt: null },
    orderBy: { generatedAt: 'desc' },
    select: { body: true, generatedAt: true, source: true },
  });

  if (!row) {
    return NextResponse.json({ map: null, generatedAt: null, source: null });
  }

  // Defensive parse — stored JSON may be from an older schema version.
  const parsed = ConceptualMapV1Schema.safeParse(row.body);
  if (!parsed.success) {
    return NextResponse.json({ map: null, generatedAt: null, source: null });
  }

  return NextResponse.json({
    map: parsed.data,
    generatedAt: row.generatedAt.toISOString(),
    source: (row.source as 'llm' | 'fallback-empty' | null) ?? 'llm',
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const owned = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true, preferredLanguage: true },
  });
  if (!owned) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  let context;
  try {
    context = await buildConceptualMapContext(clientId, auth.value.psychologistId);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  if (context.sessionIds.length === 0) {
    return NextResponse.json(
      { error: 'No completed sessions yet — record at least one session before generating a map.' },
      { status: 400 },
    );
  }

  let map: ConceptualMapV1;
  try {
    const router = modelRouter();
    const result = await router.pass7({
      clientId,
      // Cureocity is English-first for therapist surfaces; the
      // supporting quotes carry whatever language the client spoke.
      language: 'en',
      contextText: context.text,
      basedOnSessionIds: context.sessionIds,
    });
    map = result.output.conceptualMap;
    recordGeminiCall({
      pass: result.callLog.pass,
      status: result.callLog.status,
      region: result.callLog.region,
      durationMs: result.callLog.latencyMs,
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
        costInr: result.callLog.costInr,
        latencyMs: result.callLog.latencyMs,
        status: result.callLog.status,
      },
    });
  } catch (e) {
    // Surface the actual cause so the UI shows something actionable.
    // The previous saved map (if any) is left untouched — the live
    // row is only superseded after a successful persist below.
    const detail = (e as Error).message;
    console.error(
      `[conceptual-map] Pass 7 failed for client ${clientId}: ${detail}`,
      e,
    );
    return NextResponse.json(
      { error: `Generation failed: ${detail}` },
      { status: 502 },
    );
  }

  // Supersede the previous live row + insert the new one in a tx.
  const row = await prisma.$transaction(async (tx) => {
    await tx.clientConceptualMap.updateMany({
      where: { clientId, supersededAt: null },
      data: { supersededAt: new Date() },
    });
    return tx.clientConceptualMap.create({
      data: {
        clientId,
        psychologistId: auth.value.psychologistId,
        body: map,
        basedOnSessionIds: context.sessionIds,
        source: 'llm',
      },
      select: { generatedAt: true },
    });
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CONCEPTUAL_MAP_GENERATED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      nodeCount: map.nodes.length,
      edgeCount: map.edges.length,
      basedOnSessionCount: context.sessionIds.length,
    },
  });

  return NextResponse.json({
    map,
    generatedAt: row.generatedAt.toISOString(),
    source: 'llm',
  });
}
