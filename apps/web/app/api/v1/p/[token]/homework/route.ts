import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  HomeworkDoneInputSchema,
  PatientShareTokenSchema,
  TherapyScriptSnapshotSchema,
} from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/v1/p/[token]/homework — Sprint 51.
 *
 * Public (no auth): the share token IS the authentication, same trust
 * model as the /p/<token> portal page and the Sprint 47 check-in
 * submit route.
 *
 * Flips the ExerciseAssignment that was created when the therapist
 * shared this therapy script to COMPLETED, and mirrors the completion
 * flags onto every PatientShare row that points at the same
 * assignment — when a script is sent across multiple channels we
 * persist one row per channel but only one assignment; marking done
 * via any channel link must reflect on the others.
 *
 * Idempotent-ish: a second POST returns 409 so a double-tap or
 * refresh can't double-flip the row.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const tokenParse = PatientShareTokenSchema.safeParse(raw);
  if (!tokenParse.success) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  const share = await prisma.patientShare.findUnique({
    where: { shareToken: tokenParse.data },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      artefactType: true,
      snapshot: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!share || share.artefactType !== 'THERAPY_SCRIPT') {
    return NextResponse.json({ error: 'Homework not found' }, { status: 404 });
  }
  if (share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This link has expired.' }, { status: 410 });
  }

  const snapParse = TherapyScriptSnapshotSchema.safeParse(share.snapshot);
  if (!snapParse.success) {
    return NextResponse.json({ error: 'Homework could not be loaded.' }, { status: 422 });
  }
  const snapshot = snapParse.data;
  if (!snapshot.homeworkAssignmentId) {
    return NextResponse.json(
      { error: 'This homework was not set up for completion tracking.' },
      { status: 409 },
    );
  }
  if (snapshot.homeworkCompleted) {
    return NextResponse.json(
      { error: 'This homework has already been marked done.' },
      { status: 409 },
    );
  }

  const body = await parseJson(req, HomeworkDoneInputSchema);
  if (!body.ok) return body.response;

  const assignmentId = snapshot.homeworkAssignmentId;
  const now = new Date();
  const completedAtIso = now.toISOString();
  const meta = auditMetadataFromRequest(req);

  await prisma.$transaction(async (tx) => {
    // Flip the assignment row.
    await tx.exerciseAssignment.update({
      where: { id: assignmentId },
      data: { status: 'COMPLETED', completedAt: now },
    });

    // Find every sibling PatientShare row keyed to the same
    // assignment (multi-channel sends produce N rows pointing at one
    // assignment) and flip the snapshot flags on each so re-opening
    // any link reflects the completion.
    const siblings = await tx.patientShare.findMany({
      where: { clientId: share.clientId, artefactType: 'THERAPY_SCRIPT' },
      select: { id: true, snapshot: true, status: true },
    });
    for (const sib of siblings) {
      const parsed = TherapyScriptSnapshotSchema.safeParse(sib.snapshot);
      if (!parsed.success) continue;
      if (parsed.data.homeworkAssignmentId !== assignmentId) continue;
      const nextSnapshot = {
        ...parsed.data,
        homeworkCompleted: true,
        homeworkCompletedAt: completedAtIso,
      };
      await tx.patientShare.update({
        where: { id: sib.id },
        data: {
          snapshot: nextSnapshot as unknown as Prisma.InputJsonValue,
          ...(sib.status === 'SENT' ? { status: 'OPENED', openedAt: now } : {}),
        },
      });
    }

    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'EXERCISE_COMPLETION_RECORDED',
        targetType: 'ExerciseAssignment',
        targetId: assignmentId,
        metadata: {
          ...meta,
          clientId: share.clientId,
          psychologistId: share.psychologistId,
          shareId: share.id,
          source: 'therapy_script_portal',
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
