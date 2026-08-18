import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import {
  IntakeNoteV1Schema,
  MedicalEncounterNoteV1Schema,
  ReviseNoteInputSchema,
  TherapyNoteV1Schema,
  type NoteEditField,
} from '@cureocity/contracts';
import { Prisma } from '@prisma/client';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { SIGNABLE_FIELDS_BY_KIND, signableKindFor } from '@/lib/note-edit-fields';
import { canonicalJson } from '@/lib/sign-note-payload';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class EditHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type LockedSession = {
  id: string;
  psychologistId: string;
  kind: string;
  vertical: string;
};
type LockedDraft = { id: string; status: string; content: Prisma.JsonValue | null };
type LockedNote = {
  id: string;
  draftId: string;
  locked: boolean;
  content: Prisma.JsonValue;
};

/** Revise only the unlocked draft under the global Session → Draft → Note lock order. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const body = await parseJson(req, ReviseNoteInputSchema);
  if (!body.ok) return body.response;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const sessions = await tx.$queryRaw<LockedSession[]>`
        SELECT s."id", s."psychologistId", s."kind", p."vertical"
        FROM "sessions" s
        JOIN "psychologists" p ON p."id" = s."psychologistId"
        WHERE s."id" = ${sessionId}
        FOR UPDATE OF s, p
      `;
      const session = sessions[0];
      if (!session || session.psychologistId !== auth.value.psychologistId) {
        throw new EditHttpError(404, 'Session not found');
      }

      const drafts = await tx.$queryRaw<LockedDraft[]>`
        SELECT "id", "status", "content"
        FROM "note_drafts"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const draft = drafts[0];
      if (!draft) throw new EditHttpError(404, 'Note draft not found');

      const notes = await tx.$queryRaw<LockedNote[]>`
        SELECT "id", "draftId", "locked", "content"
        FROM "therapy_notes"
        WHERE "sessionId" = ${sessionId}
        FOR UPDATE
      `;
      const note = notes[0];
      if (!note) throw new EditHttpError(404, 'Session has no signed note to revise.');
      if (note.locked) {
        throw new EditHttpError(
          409,
          'Note is locked. Re-open it with “Edit note” and re-sign to record changes.',
        );
      }
      if (note.draftId !== draft.id || draft.status !== 'COMPLETED' || draft.content === null) {
        throw new EditHttpError(409, 'Draft state changed; reload before editing');
      }
      // Unlock seeds the exact signed body. Any difference means an earlier edit
      // or signer won the race; do not silently overwrite that work.
      if (canonicalJson(draft.content) !== canonicalJson(note.content)) {
        throw new EditHttpError(409, 'Draft changed concurrently; reload before editing');
      }

      const signableKind = signableKindFor(session.kind as never, session.vertical as never);
      const noteSchema =
        signableKind === 'INTAKE'
          ? IntakeNoteV1Schema
          : signableKind === 'MEDICAL'
            ? MedicalEncounterNoteV1Schema
            : TherapyNoteV1Schema;
      const fields = SIGNABLE_FIELDS_BY_KIND[signableKind];
      if (body.value.kind !== signableKind) {
        throw new EditHttpError(
          400,
          `This session signs a ${signableKind} note; expected a ${signableKind} revision payload, got ${body.value.kind}.`,
        );
      }
      const parsedCurrent = noteSchema.safeParse(note.content);
      if (!parsedCurrent.success) {
        throw new EditHttpError(409, 'Stored note content is malformed; re-sign before revising.');
      }
      const current = parsedCurrent.data as unknown as Record<string, unknown>;
      const input = body.value as unknown as Record<string, unknown>;
      const fieldsChanged: NoteEditField[] = [];
      const patch: Record<string, string> = {};
      for (const field of fields) {
        const next = input[field];
        const before = current[field];
        if (typeof next === 'string' && typeof before === 'string' && next !== before) {
          fieldsChanged.push(field);
          patch[field] = next;
        }
      }
      if (fieldsChanged.length === 0) {
        throw new EditHttpError(422, 'No fields changed from the current signed note.');
      }
      const parsedNext = noteSchema.safeParse({ ...parsedCurrent.data, ...patch });
      if (!parsedNext.success)
        throw new EditHttpError(400, 'Revised draft has an invalid clinical shape.');

      const updated = await tx.noteDraft.updateMany({
        where: { id: draft.id, status: 'COMPLETED' },
        data: { content: parsedNext.data as unknown as object, status: 'COMPLETED' },
      });
      if (updated.count !== 1) {
        throw new EditHttpError(409, 'Draft changed concurrently; reload before editing');
      }
      const reason = (body.value as { reason: string }).reason;
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_EDITED',
          targetType: 'NoteDraft',
          targetId: draft.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            revisionOfTherapyNoteId: note.id,
            sessionId,
            kind: signableKind,
            fieldsChanged,
            revisionReasonHashHex: createHash('sha256').update(reason).digest('hex'),
          },
        },
        tx,
      );
      return { note, draft, signableKind, fieldsChanged, content: parsedNext.data };
    });

    return NextResponse.json({
      sessionId,
      therapyNoteId: result.note.id,
      draftId: result.draft.id,
      kind: result.signableKind,
      fieldsChanged: result.fieldsChanged,
      content: result.content,
      requiresResign: true,
    });
  } catch (error) {
    if (error instanceof EditHttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json(
        { error: 'Draft changed concurrently; reload before editing' },
        { status: 409 },
      );
    }
    throw error;
  }
}
