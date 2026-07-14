import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/no-show/undo — TS7.5.
 *
 * The Today board marks a no-show immediately (no confirm dialog) and
 * offers a short undo window instead. This is that undo: NO_SHOW flips
 * back to SCHEDULED, audited as its own transition so the record shows
 * both the mis-tap and the correction. Refuses any other status — undo
 * is only for reversing a no-show, never for rewinding a real session.
 * POST-only (side effect; prefetchers fire GET).
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'NO_SHOW') {
    return NextResponse.json(
      { error: `Cannot undo no-show on a ${existing.status} session` },
      { status: 400 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.session.update({
      where: { id: sessionId },
      data: { status: 'SCHEDULED' },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_NO_SHOW_UNDONE',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: existing.clientId,
          scheduledAt: existing.scheduledAt.toISOString(),
        },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(toSession(updated));
}
