import { NextResponse, type NextRequest } from 'next/server';
import { SessionRescheduleInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/reschedule — Sprint 45.
 *
 * Moves a SCHEDULED slot to a new time. The original session is
 * marked RESCHEDULED (so the audit trail keeps the original slot)
 * and a fresh SCHEDULED session is created at `newScheduledAt`,
 * inheriting clientId + modality + kind. Returns the NEW session.
 *
 * Refuses if the session is past SCHEDULED — a started/completed
 * session can't be rescheduled in place (cancel + create new instead).
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'SCHEDULED') {
    return NextResponse.json(
      { error: `Cannot reschedule a ${existing.status} session` },
      { status: 400 },
    );
  }
  const dto = await parseJson(req, SessionRescheduleInputSchema);
  if (!dto.ok) return dto.response;

  const newScheduledAt = new Date(dto.value.newScheduledAt);
  if (newScheduledAt.getTime() === existing.scheduledAt.getTime()) {
    return NextResponse.json(
      { error: 'New time is identical to the existing slot' },
      { status: 400 },
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { status: 'RESCHEDULED' },
    });
    const nextSession = await tx.session.create({
      data: {
        clientId: existing.clientId,
        psychologistId: existing.psychologistId,
        modality: existing.modality,
        kind: existing.kind,
        status: 'SCHEDULED',
        scheduledAt: newScheduledAt,
        language: existing.language,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_RESCHEDULED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: existing.clientId,
          previousScheduledAt: existing.scheduledAt.toISOString(),
          newScheduledAt: newScheduledAt.toISOString(),
          newSessionId: nextSession.id,
          ...(dto.value.reason && { reason: dto.value.reason }),
        },
      },
      tx,
    );
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_CREATED',
        targetType: 'Session',
        targetId: nextSession.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: existing.clientId,
          modality: nextSession.modality,
          kind: nextSession.kind,
          rescheduledFromSessionId: sessionId,
        },
      },
      tx,
    );
    return nextSession;
  });
  return NextResponse.json(toSession(created), { status: 201 });
}
