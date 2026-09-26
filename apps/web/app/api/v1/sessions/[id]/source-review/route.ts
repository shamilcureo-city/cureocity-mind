import { createHash } from 'node:crypto';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { prisma } from '@/lib/prisma';
import { resolveNoteTranscriptData } from '@/lib/note-transcript';
import { noteTranscriptView, TRANSCRIPT_UNAVAILABLE_MESSAGE } from '@/lib/note-transcript-view';
import {
  TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
  TRANSCRIPTION_REVIEW_WARNING,
} from '@/lib/saved-transcript';
import { canonicalJson } from '@/lib/sign-note-payload';
import {
  requireScribeDoctor,
  scribeErrorResponse,
  ScribeWorkspaceError,
} from '@/lib/scribe-workspace-auth';
import type { ScribeSourceSnapshot } from '@/lib/scribe-source-review';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
type LockedSession = {
  id: string;
  clientId: string;
  psychologistId: string;
  vertical: string;
  status: string;
  practitionerStatus: string;
  practitionerDeletedAt: Date | null;
  clientStatus: string;
};
type LockedDraft = {
  id: string;
  status: string;
  content: Prisma.JsonValue | null;
  rxPad: Prisma.JsonValue | null;
  transcriptEncrypted: string | null;
  speakerSegments: Prisma.JsonValue | null;
  errorMessage: string | null;
};

/**
 * Read one immutable-in-response snapshot under the existing lifecycle lock order.
 * This is source disclosure for human review, not an AI verification or signing receipt.
 */
export async function GET(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requireScribeDoctor(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) {
    auth.response.headers.set('Cache-Control', 'private, no-store');
    return auth.response;
  }
  const { id: sessionId } = await params;
  try {
    const snapshot = await prisma.$transaction(async (tx): Promise<ScribeSourceSnapshot> => {
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const sessions = await tx.$queryRaw<LockedSession[]>`
        SELECT s."id", s."clientId", s."psychologistId", s."status", p."vertical",
          p."status" AS "practitionerStatus", p."deletedAt" AS "practitionerDeletedAt",
          c."status" AS "clientStatus"
        FROM "sessions" s
        INNER JOIN "psychologists" p ON p."id" = s."psychologistId"
        INNER JOIN "clients" c ON c."id" = s."clientId"
        WHERE s."id" = ${sessionId}
        FOR UPDATE OF p, s
      `;
      const session = sessions[0];
      if (
        !session ||
        session.psychologistId !== auth.value.psychologistId ||
        session.clientId !== client.id ||
        session.clientStatus !== 'ACTIVE'
      ) {
        throw new ScribeWorkspaceError(404, 'Encounter not found or no longer available.');
      }
      if (
        session.vertical !== 'DOCTOR' ||
        session.practitionerStatus !== 'ACTIVE' ||
        session.practitionerDeletedAt !== null
      ) {
        throw new ScribeWorkspaceError(
          403,
          'This source review is available only to the active treating doctor.',
        );
      }
      if (session.status !== 'COMPLETED') {
        throw new ScribeWorkspaceError(
          409,
          'Wait for the captured note to finish saving before reviewing its source.',
        );
      }
      const drafts = await tx.$queryRaw<LockedDraft[]>`
        SELECT "id", "status", "content", "rxPad", "transcriptEncrypted", "speakerSegments", "errorMessage"
        FROM "note_drafts" WHERE "sessionId" = ${sessionId} FOR UPDATE
      `;
      const draft = drafts[0];
      if (!draft) throw new ScribeWorkspaceError(404, 'Saved note not found.');
      if (draft.status !== 'COMPLETED' || draft.content === null) {
        throw new ScribeWorkspaceError(
          409,
          'Wait for the captured note to finish saving before reviewing its source.',
        );
      }
      const parsed = MedicalEncounterNoteV1Schema.safeParse(draft.content);
      if (!parsed.success)
        throw new ScribeWorkspaceError(
          409,
          'The saved medical note could not be read. Reload before reviewing.',
        );
      // Identity is display freshness only: it authorizes neither mutation nor signing.
      // Include legacy segments even though their text is never used as a transcript fallback.
      const version = createHash('sha256')
        .update(
          canonicalJson({
            sessionId,
            clientId: session.clientId,
            ...draft,
          }),
        )
        .digest('hex');
      let transcript: string | null = null;
      let sourceState: ScribeSourceSnapshot['sourceState'] = 'empty';
      let sourceMessage: string | null = 'No saved transcript is available for this encounter.';
      if (draft.transcriptEncrypted !== null) {
        let source: Awaited<ReturnType<typeof resolveNoteTranscriptData>> = null;
        try {
          source = await resolveNoteTranscriptData(auth.value.psychologistId, draft);
        } catch {
          /* Preserve explicit unavailability; never expose KMS errors or fall back to plaintext. */
        }
        const view = noteTranscriptView(draft, source);
        if (!source || view.errorMessage === TRANSCRIPT_UNAVAILABLE_MESSAGE) {
          sourceState = 'unavailable';
          sourceMessage = TRANSCRIPT_UNAVAILABLE_MESSAGE;
        } else if (view.errorMessage === TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE) {
          sourceState = 'quarantined';
          sourceMessage = TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE;
        } else if (view.transcript?.trim()) {
          sourceState = 'available';
          sourceMessage = view.transcriptionWarning ? TRANSCRIPTION_REVIEW_WARNING : null;
          transcript = view.transcript;
        }
      }
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_VIEWED',
          targetType: 'NoteDraft',
          targetId: draft.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            source: 'SCRIBE_SOURCE_REVIEW',
            sourceState,
          },
        },
        tx,
      );
      return {
        draftId: draft.id,
        version,
        draftContent: parsed.data,
        transcript,
        sourceState,
        sourceMessage,
      };
    });
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const response = scribeErrorResponse(error);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
