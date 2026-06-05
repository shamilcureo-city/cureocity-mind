import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/sessions/[id]/note/edit-history — chronological list of
 * NoteEdit rows for the session's signed therapy note. Includes both
 * pre-sign edits (captured at sign time) and post-sign revisions
 * (via POST /note/edit). Empty array when the note was signed without
 * any edits and has never been revised.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      therapyNote: { select: { id: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote) {
    return NextResponse.json({ items: [] });
  }

  const rows = await prisma.noteEdit.findMany({
    where: { therapyNoteId: session.therapyNote.id },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({
    items: rows.map((r) => ({
      id: r.id,
      field: r.field,
      before: r.before,
      after: r.after,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
