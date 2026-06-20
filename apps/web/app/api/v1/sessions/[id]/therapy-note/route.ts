import { NextResponse, type NextRequest } from 'next/server';
import { IntakeNoteV1Schema, TherapyNoteV1Schema, type TherapyNote } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/sessions/:id/therapy-note — returns the signed
 * TherapyNote + edits, or 200 with `null` if none has been signed
 * yet (so the review screen can branch without a 404 round-trip).
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, kind: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const note = await prisma.therapyNote.findUnique({
    where: { sessionId },
    include: { edits: { orderBy: { createdAt: 'asc' } } },
  });
  if (!note) return NextResponse.json(null);

  // Sprint 49 — intake sessions carry IntakeNoteV1 content; pick the
  // schema by kind so the parse doesn't reject a valid intake.
  const content =
    session.kind === 'INTAKE'
      ? IntakeNoteV1Schema.parse(note.content)
      : TherapyNoteV1Schema.parse(note.content);
  const body: TherapyNote = {
    id: note.id,
    sessionId: note.sessionId,
    draftId: note.draftId,
    version: 'V1',
    content,
    signedAt: note.signedAt.toISOString(),
    signedBy: note.signedBy,
    edits: note.edits.map((e) => ({
      id: e.id,
      field: e.field,
      before: e.before,
      after: e.after,
      createdAt: e.createdAt.toISOString(),
    })),
    signCredentialId: note.signCredentialId,
    signChallengeHashHex: note.signChallengeHashHex,
    createdAt: note.createdAt.toISOString(),
  };
  return NextResponse.json(body);
}
