import { CaptureReviewInputSchema, containsTranscriptionArtifact } from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { prisma } from '@/lib/prisma';
import {
  markScribeCaptureReviewed,
  reviewedScribeNoteHash,
  scribeCaptureIntegrity,
  scribeCaptureReviewToken,
  type ScribeCaptureReviewDraft,
} from '@/lib/scribe-capture-integrity';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ id: string }> };
type LockedSession = { id: string; psychologistId: string; vertical: string; status: string };
class CaptureReviewError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Match sign/edit ordering: Client -> Session/practitioner -> Draft -> Note. */
async function lockReviewState(
  tx: Prisma.TransactionClient,
  sessionId: string,
  psychologistId: string,
) {
  await lockActiveClientForSession(tx, sessionId, psychologistId);
  const sessions = await tx.$queryRaw<LockedSession[]>`
    SELECT s."id", s."psychologistId", s."status", p."vertical"
    FROM "sessions" s
    INNER JOIN "psychologists" p ON p."id" = s."psychologistId"
    WHERE s."id" = ${sessionId}
    FOR UPDATE OF p, s
  `;
  const session = sessions[0];
  if (!session || session.psychologistId !== psychologistId)
    throw new CaptureReviewError(404, 'Session not found');
  if (session.vertical !== 'DOCTOR')
    throw new CaptureReviewError(403, 'Capture review is available only for doctor encounters.');
  const drafts = await tx.$queryRaw<ScribeCaptureReviewDraft[]>`
    SELECT "id", "status", "content", "rxPad", "transcriptEncrypted", "errorMessage"
    FROM "note_drafts"
    WHERE "sessionId" = ${sessionId}
    FOR UPDATE
  `;
  const notes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "therapy_notes" WHERE "sessionId" = ${sessionId} FOR UPDATE
  `;
  return { session, draft: drafts[0] ?? null, signed: notes.length > 0 };
}

function reviewResponse(draft: ScribeCaptureReviewDraft | null) {
  return {
    ...scribeCaptureIntegrity(draft?.errorMessage),
    draftId: draft?.id ?? null,
    reviewToken: draft ? scribeCaptureReviewToken(draft) : null,
  };
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof CaptureReviewError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ClientPhiWriteForbiddenError)
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  throw error;
}

export async function GET(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const capability = await requireCapability(req, 'MEDICAL_DOCUMENTATION', auth);
  if (!capability.ok) return capability.response;
  const { id: sessionId } = await params;
  try {
    const state = await prisma.$transaction((tx) =>
      lockReviewState(tx, sessionId, auth.value.psychologistId),
    );
    return NextResponse.json(reviewResponse(state.draft), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: Context): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const capability = await requireCapability(req, 'MEDICAL_DOCUMENTATION', auth);
  if (!capability.ok) return capability.response;
  const input = await parseJson(req, CaptureReviewInputSchema);
  if (!input.ok) return input.response;
  if (containsTranscriptionArtifact(JSON.stringify(input.value.reviewedNote)))
    return NextResponse.json(
      { error: 'Remove invalid generated text before confirming the capture review.' },
      { status: 422 },
    );
  const { id: sessionId } = await params;
  try {
    const draft = await prisma.$transaction(async (tx) => {
      const state = await lockReviewState(tx, sessionId, auth.value.psychologistId);
      if (state.signed)
        throw new CaptureReviewError(
          409,
          'This encounter was already signed. Its capture review cannot be changed.',
        );
      if (
        state.session.status !== 'COMPLETED' ||
        state.draft?.status !== 'COMPLETED' ||
        !state.draft.content
      )
        throw new CaptureReviewError(
          409,
          'Wait for the captured note to finish saving before reviewing it.',
        );
      const current = state.draft;
      if (
        current.id !== input.value.reviewedDraftId ||
        scribeCaptureReviewToken(current) !== input.value.reviewToken
      )
        throw new CaptureReviewError(
          409,
          'The captured note changed. Reload and review the current note before confirming.',
        );
      if (!scribeCaptureIntegrity(current.errorMessage).incomplete) return current;
      const errorMessage = markScribeCaptureReviewed(current, input.value.reviewedNote);
      await tx.noteDraft.update({ where: { id: current.id }, data: { errorMessage } });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_EDITED',
          targetType: 'NoteDraft',
          targetId: current.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            source: 'SCRIBE_CAPTURE_REVIEW',
            resolution: input.value.resolution,
            reviewedDraftHashHex: input.value.reviewToken,
            reviewedNoteHashHex: reviewedScribeNoteHash(input.value.reviewedNote),
            captureIncompleteReason: scribeCaptureIntegrity(current.errorMessage).reason,
          },
        },
        tx,
      );
      return { ...current, errorMessage };
    });
    return NextResponse.json(
      {
        ...reviewResponse(draft),
        reviewed: true,
        reviewedNoteHashHex: reviewedScribeNoteHash(input.value.reviewedNote),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
