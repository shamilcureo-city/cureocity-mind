import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  TherapyNoteV1Schema,
  type NoteEditField,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions/[id]/note/edit — revise a SIGNED therapy note.
 *
 * Takes the four SOAP fields (any subset; only changed fields are
 * required) plus a free-text reason for the revision. Server computes
 * the diff against the current TherapyNote.content, persists a
 * NoteEdit row per changed field, and writes the new content back.
 *
 * The reason is appended to the audit metadata so the regulator can
 * reconstruct WHY a signed clinical document was modified. We use the
 * existing NOTE_SIGNED audit verb with metadata `{ revision: true }`
 * — revising essentially re-signs the document (the therapist takes
 * authorship of the new version), which keeps the audit surface
 * additive without enum sprawl.
 */
const ReviseInputSchema = z
  .object({
    subjective: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
    assessment: z.string().min(1).optional(),
    plan: z.string().min(1).optional(),
    reason: z.string().min(5).max(2000),
  })
  .refine((d) => d.subjective || d.objective || d.assessment || d.plan, {
    message: 'At least one SOAP field must be revised',
  });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const body = await parseJson(req, ReviseInputSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, psychologistId: true, kind: true, therapyNote: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote || !session.therapyNote.content) {
    return NextResponse.json(
      { error: 'Session has no signed note to revise.' },
      { status: 404 },
    );
  }
  // Sprint 49 — this route is SOAP-only. Intake-note revisions aren't
  // wired through this contract yet; the modify-then-sign path is the
  // current intake editing surface.
  if (session.kind === 'INTAKE') {
    return NextResponse.json(
      {
        error:
          'Editing a signed intake note is not yet supported through this endpoint. Modify the draft and re-sign instead.',
      },
      { status: 409 },
    );
  }

  const current = TherapyNoteV1Schema.parse(session.therapyNote.content);
  const edits: Array<{ field: NoteEditField; before: string; after: string }> = [];
  for (const field of ['subjective', 'objective', 'assessment', 'plan'] as const) {
    const next = body.value[field];
    if (next !== undefined && next !== current[field]) {
      edits.push({ field, before: current[field], after: next });
    }
  }
  if (edits.length === 0) {
    return NextResponse.json(
      { error: 'No fields changed from the current signed note.' },
      { status: 422 },
    );
  }

  const nextContent: TherapyNoteV1 = {
    ...current,
    ...(body.value.subjective !== undefined && { subjective: body.value.subjective }),
    ...(body.value.objective !== undefined && { objective: body.value.objective }),
    ...(body.value.assessment !== undefined && { assessment: body.value.assessment }),
    ...(body.value.plan !== undefined && { plan: body.value.plan }),
  };
  // Defensive — should always pass since we only mutate string fields,
  // but a Zod re-parse catches any incidental shape drift early.
  TherapyNoteV1Schema.parse(nextContent);

  const therapyNoteId = session.therapyNote.id;
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
          ...auditMetadataFromRequest(req),
          revision: true,
          sessionId: session.id,
          fieldsChanged: edits.map((e) => e.field),
          reason: body.value.reason,
        },
      },
      tx,
    );
  });

  return NextResponse.json({
    sessionId,
    therapyNoteId,
    fieldsChanged: edits.map((e) => e.field),
    content: nextContent,
  });
}
