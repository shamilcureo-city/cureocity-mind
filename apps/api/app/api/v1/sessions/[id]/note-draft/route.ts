import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/sessions/:id/note-draft — surfaces the Pass 1 + Pass 2
 * output. 404 if the session belongs to another psychologist (cross-
 * tenant non-leak); 404 if the draft hasn't been created yet (the
 * /end route creates it).
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const draft = await prisma.noteDraft.findUnique({ where: { sessionId } });
  if (!draft) {
    return NextResponse.json({ error: 'Note draft not yet generated' }, { status: 404 });
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'NOTE_DRAFT_VIEWED',
    targetType: 'NoteDraft',
    targetId: draft.id,
    metadata: auditMetadataFromRequest(req),
  });
  return NextResponse.json(toNoteDraft(draft));
}
