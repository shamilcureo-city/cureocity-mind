import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { MindCueReviewInputSchema, cueReviewKey, readMindCueReview } from '@/lib/mind-cue-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const missing = () => NextResponse.json({ error: 'Session not found' }, { status: 404 });

async function ownedMindSession(id: string, psychologistId: string) {
  return prisma.session.findFirst({
    where: {
      id,
      psychologistId,
      psychologist: { vertical: 'THERAPIST' },
      client: { is: { deletedAt: null } },
    },
    select: { id: true, status: true },
  });
}

/** UI cue choices only, never a clinical assessment or signed-note amendment. */
export async function GET(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const psychologistId = auth.value.psychologistId;
  if (!(await ownedMindSession(sessionId, psychologistId))) return missing();
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, psychologistId);
      const rows = await tx.auditLog.findMany({
        where: {
          actorPsychologistId: psychologistId,
          targetType: 'MindCueReview',
          metadata: { path: ['sessionId'], equals: sessionId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['targetId'],
        take: 501,
        select: { metadata: true, createdAt: true },
      });
      if (rows.length > 500) return null;
      const records = rows.map((row) => readMindCueReview(row.metadata, row.createdAt));
      if (records.some((record) => record === null)) return null;
      const ids = records.flatMap((record) => (record ? [record.id] : []));
      // Descriptions come only from existing shown-event audit rows. No new
      // labels/transcripts are accepted or logged by this review endpoint.
      const shown = ids.length
        ? await tx.auditLog.findMany({
            where: {
              actorPsychologistId: psychologistId,
              targetType: 'LiveSuggestion',
              targetId: { in: ids },
              metadata: { path: ['sessionId'], equals: sessionId },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1000,
            select: { targetId: true, metadata: true },
          })
        : [];
      const labels: Record<string, string> = {};
      for (const row of shown) {
        const metadata = row.metadata as Record<string, unknown> | null;
        const record = records.find(
          (item) => item?.id === row.targetId && item.kind === metadata?.kind,
        );
        if (!record || typeof metadata?.label !== 'string') continue;
        const key = cueReviewKey(record.kind, record.id);
        if (!labels[key]) labels[key] = metadata.label.slice(0, 2000);
      }
      return { records, labels };
    });
    if (!result)
      return NextResponse.json(
        { error: 'Cue history could not be verified in full.' },
        { status: 409 },
      );
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return missing();
    throw error;
  }
}

export async function POST(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const psychologistId = auth.value.psychologistId;
  const parsed = await parseJson(req, MindCueReviewInputSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.value;
  const session = await ownedMindSession(sessionId, psychologistId);
  if (!session) return missing();
  if (session.status !== 'IN_PROGRESS' && session.status !== 'SCHEDULED')
    return NextResponse.json(
      { error: 'Live cue review is closed for this session.' },
      { status: 409 },
    );
  try {
    const record = await prisma.$transaction(async (tx) => {
      // Same lock as erasure, and same order as other clinical writers. It
      // also serializes review/Undo/retry for every session of this client.
      const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
      const currentSession = await tx.session.findFirst({
        where: {
          id: sessionId,
          clientId: client.id,
          psychologistId,
          psychologist: { vertical: 'THERAPIST' },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
        select: { id: true },
      });
      if (!currentSession) return null;
      const previousRow = await tx.auditLog.findFirst({
        where: {
          actorPsychologistId: psychologistId,
          targetType: 'MindCueReview',
          targetId: cueReviewKey(input.kind, input.id),
          metadata: { path: ['sessionId'], equals: sessionId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { metadata: true, createdAt: true },
      });
      const previous =
        previousRow && readMindCueReview(previousRow.metadata, previousRow.createdAt);
      if (previousRow && !previous) return null;
      if (previous?.operationId === input.operationId)
        return previous.kind === input.kind &&
          previous.state === input.state &&
          previous.fingerprint === input.fingerprint
          ? previous
          : null;
      if ((previous?.operationId ?? null) !== input.expectedRevision) return null;
      if (previous && previous.kind !== input.kind) return null;
      if (!previous) {
        if (input.state === 'reopened') return null;
        const shown = await tx.auditLog.findFirst({
          where: {
            actorPsychologistId: psychologistId,
            targetType: 'LiveSuggestion',
            targetId: input.id,
            action: 'LIVE_SUGGESTION_SHOWN',
            AND: [
              { metadata: { path: ['sessionId'], equals: sessionId } },
              { metadata: { path: ['kind'], equals: input.kind } },
            ],
          },
          select: { id: true },
        });
        if (!shown) return null;
      }
      const base = {
        actorType: 'PSYCHOLOGIST' as const,
        actorPsychologistId: psychologistId,
        targetType: 'MindCueReview',
        targetId: cueReviewKey(input.kind, input.id),
        metadata: {
          ...auditMetadataFromRequest(req),
          sessionId,
          clientId: client.id,
          mindCueReviewVersion: 1,
          suggestionId: input.id,
          kind: input.kind,
          reviewState: input.state,
          operationId: input.operationId,
          fingerprint: input.fingerprint,
          clinicalAssessmentRecorded: false,
        },
      };
      if (input.state === 'reopened')
        await writeAudit({ ...base, action: 'LIVE_SUGGESTION_SHOWN' }, tx);
      else await writeAudit({ ...base, action: 'LIVE_SUGGESTION_DISMISSED' }, tx);
      return {
        id: input.id,
        kind: input.kind,
        state: input.state,
        operationId: input.operationId,
        fingerprint: input.fingerprint,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!record)
      return NextResponse.json(
        {
          error:
            'Cue history changed or this cue could not be verified. Reload before correcting it.',
        },
        { status: 409 },
      );
    return NextResponse.json(record, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return missing();
    throw error;
  }
}
