import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions/[id]/note/unlock — re-open a signed note for editing.
 *
 * Sprint 71: signing is no longer terminal. Unlocking flips the signed note
 * to `locked = false` and syncs the editable draft to the (current) signed
 * content, so the note returns to the "completed" editable state where the
 * full template / language / edit toolbar already works. Re-signing re-locks
 * it (sign route), and the NoteEdit history is preserved throughout.
 *
 * POST-only (a side effect; never reachable by GET — see docs/AUTH_SESSION.md).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      psychologistId: true,
      therapyNote: { select: { id: true, content: true, draftId: true, locked: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote) {
    return NextResponse.json({ error: 'No signed note to unlock.' }, { status: 404 });
  }
  if (!session.therapyNote.locked) {
    // Already open for editing — idempotent success.
    return NextResponse.json({ ok: true, locked: false });
  }

  const note = session.therapyNote;
  await prisma.$transaction(async (tx) => {
    await tx.therapyNote.update({
      where: { id: note.id },
      data: { locked: false },
    });
    // Re-seed the editable draft from the current signed content so the
    // therapist edits from what they signed, not a stale pre-sign draft.
    await tx.noteDraft.update({
      where: { id: note.draftId },
      data: { content: note.content as unknown as object, status: 'COMPLETED' },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_UNLOCKED',
        targetType: 'TherapyNote',
        targetId: note.id,
        metadata: { ...auditMetadataFromRequest(req), sessionId },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, locked: false });
}
