import { NextResponse, after, type NextRequest } from 'next/server';
import { SessionRescheduleInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { sendAppointmentRescheduledEmail } from '@/lib/appointment-email';
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

  const { created, movedAppointmentId } = await prisma.$transaction(async (tx) => {
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
    // A session minted from a public booking carries a linked Appointment.
    // Move it WITH the session: same new time, pointed at the new row, and
    // reminder stamps cleared so the 24h/2h emails fire for the new slot.
    // Without this the patient keeps being reminded of the OLD time, their
    // video join window opens at the old time, and their cancel link
    // targets a row that is no longer the real session.
    const linkedAppt = await tx.appointment.findFirst({
      where: {
        sessionId,
        psychologistId: auth.value.psychologistId,
        status: 'CONFIRMED',
      },
    });
    if (linkedAppt) {
      const durationMs = linkedAppt.endAt.getTime() - linkedAppt.startAt.getTime();
      await tx.appointment.update({
        where: { id: linkedAppt.id },
        data: {
          startAt: newScheduledAt,
          endAt: new Date(newScheduledAt.getTime() + durationMs),
          sessionId: nextSession.id,
          reminded24At: null,
          reminded2At: null,
        },
      });
    }
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
          ...(linkedAppt && { movedAppointmentId: linkedAppt.id }),
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
    return { created: nextSession, movedAppointmentId: linkedAppt?.id ?? null };
  });

  // Tell the patient their time moved (best-effort, off the request path;
  // only possible when the booking left an email).
  if (movedAppointmentId) {
    after(() =>
      sendAppointmentRescheduledEmail(
        auth.value.psychologistId,
        movedAppointmentId,
        newScheduledAt,
      ),
    );
  }

  return NextResponse.json(toSession(created), { status: 201 });
}
