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
 * POST /api/v1/sessions/[id]/note/edit — revise a SIGNED note.
 *
 * Sprint 55 widens this route to both TREATMENT (SOAP) and INTAKE notes
 * via a `kind`-discriminated input. The server is the source of truth
 * on kind: it derives the SIGNABLE kind from the session and rejects a
 * payload addressed to the wrong shape.
 *
 * REVIEW sessions sign a SOAP `TherapyNoteV1` (they reuse TREATMENT's
 * shape — see sign/route.ts + `signableKindFor`), so a REVIEW session's
 * Revise UI posts `kind: 'TREATMENT'` and is handled by the SOAP path.
 *
 * The reason is appended to the audit metadata so the regulator can
 * reconstruct WHY a signed clinical document was modified. We reuse the
 * existing NOTE_SIGNED audit verb with metadata `{ revision: true, kind,
 * sessionKind }` — revising essentially re-signs the document, keeping
 * the audit surface additive without enum sprawl.
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
    select: { id: true, psychologistId: true, kind: true, therapyNote: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote || !session.therapyNote.content) {
    return NextResponse.json({ error: 'Session has no signed note to revise.' }, { status: 404 });
  }

  // Map the session kind to the note shape it actually signs. A payload
  // addressed to the other shape usually means a stale UI tab — reject
  // so the client refetches rather than writing a SOAP edit onto an
  // intake note (or vice versa).
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

  // Defensive: the stored content was validated at sign time, but a
  // drifted / hand-corrected row could fail to parse. safeParse keeps
  // that a clean 409 instead of an uncaught ZodError → 500.
  const parsedCurrent = noteSchema.safeParse(session.therapyNote.content);
  if (!parsedCurrent.success) {
    return NextResponse.json(
      { error: 'Stored note content is malformed; re-sign the note before revising.' },
      { status: 409 },
    );
  }
  const current = parsedCurrent.data as Record<string, unknown>;
  const input = body.value as Record<string, unknown>;

  // Single pass: a field that changed gets BOTH a NoteEdit row and a
  // merge-patch entry, so content can only change through a recorded
  // edit (unchanged fields fall through from `current` on re-parse).
  const edits: Array<{ field: NoteEditField; before: string; after: string }> = [];
  const patch: Record<string, string> = {};
  for (const field of fields) {
    const next = input[field];
    if (typeof next !== 'string') continue; // field not provided
    const before = current[field];
    if (typeof before === 'string' && next !== before) {
      edits.push({ field, before, after: next });
      patch[field] = next;
    }
  }
  if (edits.length === 0) {
    return NextResponse.json(
      { error: 'No fields changed from the current signed note.' },
      { status: 422 },
    );
  }

  // Re-parse the merged content so schema invariants (and the lenient
  // mentalStatusExam preprocess for intake, CLAUDE.md §7) re-run.
  const nextContent = noteSchema.parse({ ...parsedCurrent.data, ...patch });
  const reason = (body.value as { reason: string }).reason;
  const therapyNoteId = session.therapyNote.id;
  const auditMeta = auditMetadataFromRequest(req);

  await prisma.$transaction(async (tx) => {
    await tx.noteEdit.createMany({
      data: edits.map((e) => ({
        therapyNoteId,
        field: e.field,
        before: e.before,
        after: e.after,
      })),
    });
    await tx.therapyNote.update({
      where: { id: therapyNoteId },
      data: { content: nextContent as unknown as object },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_SIGNED',
        targetType: 'TherapyNote',
        targetId: therapyNoteId,
        metadata: {
          ...auditMeta,
          revision: true,
          kind: signableKind,
          // Raw session kind so My Practice can still separate REVIEW
          // re-evaluations from first-line TREATMENT revisions.
          sessionKind: session.kind,
          sessionId: session.id,
          fieldsChanged: edits.map((e) => e.field),
          reason,
        },
      },
      tx,
    );
  });

  return NextResponse.json({
    sessionId,
    therapyNoteId,
    kind: signableKind,
    fieldsChanged: edits.map((e) => e.field),
    content: nextContent,
  });
}
