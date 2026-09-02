import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  HomeworkResponseInputSchema,
  HomeworkSnapshotSchema,
  PatientShareTokenSchema,
  TherapyScriptSnapshotSchema,
} from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { lockShareFamily } from '@/lib/share-family-lock';
import { isUsableResendAncestorStatus } from '@/lib/sprint5-final-behavior';

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
      shareBatchId: true,
      clientId: true,
      psychologistId: true,
      artefactType: true,
      snapshot: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!share || (share.artefactType !== 'THERAPY_SCRIPT' && share.artefactType !== 'HOMEWORK')) {
    return NextResponse.json({ error: 'Homework not found' }, { status: 404 });
  }
  if (share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This link has expired.' }, { status: 410 });
  }
  if (!['SENT', 'OPENED'].includes(share.status)) {
    return NextResponse.json({ error: 'Homework not found' }, { status: 404 });
  }

  const snapParse =
    share.artefactType === 'HOMEWORK'
      ? HomeworkSnapshotSchema.safeParse(share.snapshot)
      : TherapyScriptSnapshotSchema.safeParse(share.snapshot);
  if (!snapParse.success) {
    return NextResponse.json({ error: 'Homework could not be loaded.' }, { status: 422 });
  }
  const snapshot = snapParse.data;
  const linkedAssignmentId =
    snapshot.kind === 'HOMEWORK' ? snapshot.assignmentId : snapshot.homeworkAssignmentId;
  if (!linkedAssignmentId) {
    return NextResponse.json(
      { error: 'This homework was not set up for completion tracking.' },
      { status: 409 },
    );
  }
  const body = await parseJson(req, HomeworkResponseInputSchema);
  if (!body.ok) return body.response;

  const assignmentId = linkedAssignmentId;
  const now = new Date();
  const completed = body.value.outcome === 'DONE';
  const completedAtIso = completed ? now.toISOString() : null;
  const meta = auditMetadataFromRequest(req);

  const committed = await prisma
    .$transaction(async (tx) => {
      await lockShareFamily(tx, share);
      const currentShare = await tx.patientShare.findUnique({
        where: { id: share.id },
        select: {
          status: true,
          expiresAt: true,
          artefactId: true,
          artefactType: true,
          snapshot: true,
          resendOfId: true,
        },
      });
      const currentSnapshot =
        currentShare?.artefactType === 'THERAPY_SCRIPT'
          ? TherapyScriptSnapshotSchema.safeParse(currentShare.snapshot).data
          : undefined;
      if (!currentShare || !['SENT', 'OPENED'].includes(currentShare.status))
        throw new HomeworkWithdrawnError();
      if (!(await activeShareAncestors(tx, currentShare.resendOfId))) {
        throw new HomeworkWithdrawnError();
      }
      if (
        currentShare.expiresAt <= new Date() ||
        (currentShare.artefactType === 'HOMEWORK'
          ? currentShare.artefactId !== assignmentId
          : currentSnapshot?.homeworkAssignmentId !== assignmentId)
      )
        throw new HomeworkReplayError();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assignmentId}))`;
      const current = await tx.exerciseAssignment.findFirst({
        where: {
          id: assignmentId,
          clientId: share.clientId,
          psychologistId: share.psychologistId,
        },
        select: { id: true, response: true },
      });
      // Every portal response is a clinical event, including PARTLY and
      // NOT_YET. Once one event is stored, replays and concurrent submissions
      // must not overwrite it with a different answer.
      if (!current || current.response !== null) throw new HomeworkReplayError();
      await tx.exerciseAssignment.update({
        where: { id: current.id },
        data: {
          status: completed
            ? 'COMPLETED'
            : body.value.outcome === 'PARTLY'
              ? 'IN_PROGRESS'
              : 'PENDING',
          completedAt: completed ? now : null,
          response: { outcome: body.value.outcome, reflection: body.value.reflection ?? null },
          respondedAt: now,
          responseShareId: share.id,
          responseShareBatchId: share.shareBatchId,
        },
      });

      // Find every sibling PatientShare row keyed to the same
      // assignment (multi-channel sends produce N rows pointing at one
      // assignment) and flip the snapshot flags on each so re-opening
      // any link reflects the completion.
      const siblings = await tx.patientShare.findMany({
        where: {
          clientId: share.clientId,
          artefactType: { in: ['THERAPY_SCRIPT', 'HOMEWORK'] },
          status: { in: ['SENT', 'OPENED'] },
        },
        select: { id: true, artefactType: true, snapshot: true, status: true },
      });
      for (const sib of siblings) {
        const script = TherapyScriptSnapshotSchema.safeParse(sib.snapshot);
        if (script.success && script.data.homeworkAssignmentId === assignmentId) {
          const changed = await tx.patientShare.updateMany({
            where: { id: sib.id, status: { in: ['SENT', 'OPENED'] } },
            data: {
              snapshot: {
                ...script.data,
                homeworkCompleted: completed,
                homeworkCompletedAt: completedAtIso,
              } as unknown as Prisma.InputJsonValue,
              ...(sib.id === share.id && sib.status === 'SENT'
                ? { status: 'OPENED', openedAt: now }
                : {}),
            },
          });
          if (sib.id === share.id && changed.count !== 1) throw new HomeworkWithdrawnError();
          continue;
        }
        const homework = HomeworkSnapshotSchema.safeParse(sib.snapshot);
        if (!homework.success || homework.data.assignmentId !== assignmentId) continue;
        const changed = await tx.patientShare.updateMany({
          where: { id: sib.id, status: { in: ['SENT', 'OPENED'] } },
          data: {
            snapshot: {
              ...homework.data,
              responseOutcome: body.value.outcome,
              responseReflection: body.value.reflection ?? null,
              respondedAt: now.toISOString(),
            } as unknown as Prisma.InputJsonValue,
            ...(sib.id === share.id && sib.status === 'SENT'
              ? { status: 'OPENED', openedAt: now }
              : {}),
          },
        });
        if (sib.id === share.id && changed.count !== 1) throw new HomeworkWithdrawnError();
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
            source: share.artefactType === 'HOMEWORK' ? 'homework_portal' : 'therapy_script_portal',
          },
        },
        tx,
      );
      return true;
    })
    .catch((error: unknown) => {
      if (error instanceof HomeworkReplayError) return false;
      if (error instanceof HomeworkWithdrawnError) return 'WITHDRAWN' as const;
      throw error;
    });

  if (committed === 'WITHDRAWN') {
    return NextResponse.json({ error: 'Homework not found' }, { status: 404 });
  }
  if (!committed) {
    return NextResponse.json({ error: 'This response was already recorded.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, outcome: body.value.outcome });
}

class HomeworkReplayError extends Error {}
class HomeworkWithdrawnError extends Error {}

async function activeShareAncestors(
  tx: Prisma.TransactionClient,
  parentId: string | null,
): Promise<boolean> {
  let cursor = parentId;
  while (cursor) {
    const parent = await tx.patientShare.findUnique({
      where: { id: cursor },
      select: { status: true, resendOfId: true },
    });
    if (!parent || !isUsableResendAncestorStatus(parent.status)) return false;
    cursor = parent.resendOfId;
  }
  return true;
}
