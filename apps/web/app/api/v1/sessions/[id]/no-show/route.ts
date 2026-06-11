import { NextResponse, type NextRequest } from 'next/server';
import { SessionNoShowInputSchema } from '@cureocity/contracts';
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
 * POST /api/v1/sessions/:id/no-show — Sprint 45.
 *
 * Marks a SCHEDULED session as NO_SHOW when the client didn't arrive.
 * Refuses if the session has already advanced past SCHEDULED so a
 * therapist can't accidentally retro-write status onto a recorded
 * session. The optional note is captured in audit metadata.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'SCHEDULED') {
    return NextResponse.json(
      { error: `Cannot mark a ${existing.status} session as no-show` },
      { status: 400 },
    );
  }
  const dto = await parseJson(req, SessionNoShowInputSchema);
  if (!dto.ok) return dto.response;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.session.update({
      where: { id: sessionId },
      data: { status: 'NO_SHOW' },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_NO_SHOW',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: existing.clientId,
          scheduledAt: existing.scheduledAt.toISOString(),
          ...(dto.value.note && { note: dto.value.note }),
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toSession(updated));
}
