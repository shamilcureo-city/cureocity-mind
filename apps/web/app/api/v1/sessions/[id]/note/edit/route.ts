import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  IntakeNoteV1Schema,
  ReviseNoteInputSchema,
  TherapyNoteV1Schema,
  type NoteEditField,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { SIGNABLE_FIELDS_BY_KIND, signableKindFor } from '@/lib/note-edit-fields';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revise an unlocked signed note by changing its editable NoteDraft only.
 * TherapyNote remains the last persisted signed body; the sign route validates
 * the draft, records field history, and replaces it only after canonical signing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const body = await parseJson(req, ReviseNoteInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      kind: true,
      therapyNote: { select: { id: true, draftId: true, locked: true, content: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote?.content) {
    return NextResponse.json({ error: 'Session has no signed note to revise.' }, { status: 404 });
  }
  if (session.therapyNote.locked) {
    return NextResponse.json(
      { error: 'Note is locked. Re-open it with “Edit note” and re-sign to record changes.' },
      { status: 409 },
    );
  }

  const signableKind = signableKindFor(session.kind);
  if (body.value.kind !== signableKind) {
    return NextResponse.json(
      {
        error: `This session signs a ${signableKind} note; expected a ${signableKind} revision payload, got ${body.value.kind}.`,
      },
      { status: 400 },
    );
  }

  const noteSchema = signableKind === 'INTAKE' ? IntakeNoteV1Schema : TherapyNoteV1Schema;
  const fields = SIGNABLE_FIELDS_BY_KIND[signableKind];
  const parsedCurrent = noteSchema.safeParse(session.therapyNote.content);
  if (!parsedCurrent.success) {
    return NextResponse.json(
      { error: 'Stored note content is malformed; re-sign the note before revising.' },
      { status: 409 },
    );
  }
  const current = parsedCurrent.data as Record<string, unknown>;
  const input = body.value as Record<string, unknown>;
  const fieldsChanged: NoteEditField[] = [];
  const patch: Record<string, string> = {};
  for (const field of fields) {
    const next = input[field];
    if (typeof next !== 'string') continue;
    const before = current[field];
    if (typeof before === 'string' && next !== before) {
      fieldsChanged.push(field);
      patch[field] = next;
    }
  }
  if (fieldsChanged.length === 0) {
    return NextResponse.json(
      { error: 'No fields changed from the current signed note.' },
      { status: 422 },
    );
  }

  const parsedNext = noteSchema.safeParse({ ...parsedCurrent.data, ...patch });
  if (!parsedNext.success) {
    return NextResponse.json(
      { error: 'Revised draft has an invalid clinical shape.' },
      { status: 400 },
    );
  }
  const nextContent = parsedNext.data;
  const reason = (body.value as { reason: string }).reason;
  const auditMeta = auditMetadataFromRequest(req);

  await prisma.$transaction(async (tx) => {
    await tx.noteDraft.update({
      where: { id: session.therapyNote!.draftId },
      data: { content: nextContent as unknown as object, status: 'COMPLETED' },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_DRAFT_EDITED',
        targetType: 'NoteDraft',
        targetId: session.therapyNote!.draftId,
        metadata: {
          ...auditMeta,
          revisionOfTherapyNoteId: session.therapyNote!.id,
          sessionId: session.id,
          kind: signableKind,
          fieldsChanged,
          revisionReasonHashHex: createHash('sha256').update(reason).digest('hex'),
        },
      },
      tx,
    );
  });

  return NextResponse.json({
    sessionId,
    therapyNoteId: session.therapyNote.id,
    draftId: session.therapyNote.draftId,
    kind: signableKind,
    fieldsChanged,
    content: nextContent,
    requiresResign: true,
  });
}
