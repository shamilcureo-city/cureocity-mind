import { NextResponse, type NextRequest } from 'next/server';
import { SessionFeedbackInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/sessions/[id]/feedback — the one-tap alliance read captured
 * at session close ("how did the session land?"). Idempotent overwrite;
 * audited `SESSION_FEEDBACK_RECORDED`. Alliance drift shows here before it
 * shows in the scores.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const body = await parseJson(req, SessionFeedbackInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findFirst({
    where: { id: sessionId, psychologistId: auth.value.psychologistId },
    select: { id: true, clientId: true },
  });
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      where: { id: sessionId },
      data: { allianceRating: body.value.alliance },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_FEEDBACK_RECORDED',
        targetType: 'Session',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: session.clientId,
          alliance: body.value.alliance,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
