import { NextResponse, type NextRequest } from 'next/server';
import { CreateNoteReviewInputSchema, type NoteReview } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

function toDto(row: {
  id: string;
  reviewerName: string;
  reviewerNote: string | null;
  reviewedAt: Date;
  createdAt: Date;
  reviewedSignatureHash: string | null;
  reviewedSignedAt: Date | null;
}): NoteReview {
  return {
    id: row.id,
    reviewerName: row.reviewerName,
    reviewerNote: row.reviewerNote,
    reviewedAt: row.reviewedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    reviewedSignatureHash: row.reviewedSignatureHash,
    reviewedSignedAt: row.reviewedSignedAt?.toISOString() ?? null,
  };
}

/**
 * GET /api/v1/sessions/[id]/note/review — Sprint 68.
 * List supervision reviews recorded on this session's note. Tenant-gated.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const rows = await prisma.noteReview.findMany({
    where: { sessionId, psychologistId: auth.value.psychologistId },
    orderBy: { reviewedAt: 'desc' },
  });
  return NextResponse.json({ reviews: rows.map(toDto) });
}

/**
 * POST /api/v1/sessions/[id]/note/review — Sprint 68.
 *
 * Record that the signed note was reviewed in supervision. Requires a
 * signed note (you review a finalised note, not a draft). Tenant-gated;
 * audits NOTE_REVIEW_RECORDED.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, CreateNoteReviewInputSchema);
  if (!dto.ok) return dto.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, therapyNote: { select: { id: true } } },
  });
  if (!session || session.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (!session.therapyNote) {
    return NextResponse.json(
      { error: 'Sign the note before recording a supervision review.' },
      { status: 409 },
    );
  }

  const reviewedAt = dto.value.reviewedAt ? new Date(dto.value.reviewedAt) : new Date();

  try {
    const row = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, psychologistId);
      const notes = await tx.$queryRaw<
        {
          id: string;
          locked: boolean;
          signPayload: string | null;
          signChallengeHashHex: string | null;
          signedAt: Date;
        }[]
      >`
        SELECT n."id", n."locked", n."signPayload", n."signChallengeHashHex", n."signedAt"
        FROM "therapy_notes" n JOIN "sessions" s ON s."id" = n."sessionId"
        WHERE s."id" = ${sessionId} AND s."psychologistId" = ${psychologistId}
        FOR UPDATE OF n
      `;
      const note = notes[0];
      if (
        !note?.locked ||
        !note.signPayload ||
        note.signChallengeHashHex !== dto.value.reviewedSignatureHash
      )
        return null;
      const created = await tx.noteReview.create({
        data: {
          sessionId,
          therapyNoteId: note.id,
          psychologistId,
          reviewerName: dto.value.reviewerName,
          reviewerNote: dto.value.reviewerNote ?? null,
          reviewedAt,
          reviewedSignatureHash: note.signChallengeHashHex,
          reviewedSignedAt: note.signedAt,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'NOTE_REVIEW_RECORDED',
          targetType: 'NoteReview',
          targetId: created.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            reviewedSignatureHash: note.signChallengeHashHex,
          },
        },
        tx,
      );
      return created;
    });
    if (!row)
      return NextResponse.json(
        {
          error:
            'The signed note changed or was reopened. Reload and review the current signed version.',
        },
        { status: 409 },
      );
    return NextResponse.json({ review: toDto(row) }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    throw error;
  }
}
