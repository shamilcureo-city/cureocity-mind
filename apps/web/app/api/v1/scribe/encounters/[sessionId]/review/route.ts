import { NextResponse, type NextRequest } from 'next/server';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import { ScribeEncounterReviewSchema } from '@/lib/scribe-encounter-review';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) return auth.response;
  const { sessionId } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const owners = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "psychologists" WHERE "id" = ${auth.value.psychologistId}
        AND "vertical" = 'DOCTOR' AND "status" = 'ACTIVE' AND "deletedAt" IS NULL FOR SHARE
      `;
      if (!owners[0])
        throw new ScribeWorkspaceError(403, 'The doctor workspace is no longer active.');
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "note_drafts" WHERE "sessionId" = ${sessionId} FOR SHARE`;
      await tx.$queryRaw`SELECT "id" FROM "therapy_notes" WHERE "sessionId" = ${sessionId} FOR SHARE`;
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          psychologistId: true,
          client: { select: { status: true } },
          noteDraft: { select: { id: true, status: true, content: true, errorMessage: true } },
          therapyNote: {
            select: { id: true, locked: true, content: true, rxPad: true, signedAt: true },
          },
        },
      });
      if (
        !session ||
        session.psychologistId !== auth.value.psychologistId ||
        session.client.status !== 'ACTIVE'
      )
        throw new ScribeWorkspaceError(404, 'Encounter not found or no longer available.');
      const draft = session.noteDraft;
      const signed = session.therapyNote?.locked ? session.therapyNote : null;
      const draftContent = MedicalEncounterNoteV1Schema.safeParse(draft?.content);
      if (!signed && draft?.status === 'COMPLETED' && !draftContent.success)
        throw new ScribeWorkspaceError(409, 'The saved medical draft could not be read.');
      const result = ScribeEncounterReviewSchema.parse({
        draft: draft
          ? {
              status: draft.status,
              content: draftContent.success ? draftContent.data : null,
              errorMessage: draft.errorMessage,
            }
          : null,
        signedNote: signed
          ? {
              content: signed.content,
              rxPad: signed.rxPad,
              signedAt: signed.signedAt.toISOString(),
            }
          : null,
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_VIEWED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: {
            ...auditMetadataFromRequest(req),
            surface: 'scribe_encounter_review',
            signed: signed !== null,
          },
        },
        tx,
      );
      return result;
    });
    return NextResponse.json(result, { headers });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', headers['Cache-Control']);
    return response;
  }
}
