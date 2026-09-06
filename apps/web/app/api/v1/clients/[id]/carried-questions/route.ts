import { NextResponse, type NextRequest } from 'next/server';
import { SaveCarriedQuestionsInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { lockActiveClient } from '@/lib/phi-write-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint TSC — POST /api/v1/clients/[id]/carried-questions
 *
 * The copilot decision board's "carry to next session": persists the
 * questions the therapist ticked so the client's next pre-session brief
 * opens with them. Replaces the list wholesale (the board always sends the
 * full current selection; an empty list clears it). Tenant-checked,
 * POST-only (side effects must never be reachable by a prefetched GET).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;

  const body = await parseJson(req, SaveCarriedQuestionsInputSchema);
  if (!body.ok) return body.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { psychologistId: true, deletedAt: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (body.value.sourceSessionId) {
    const source = await prisma.session.findFirst({
      where: {
        id: body.value.sourceSessionId,
        clientId,
        psychologistId: auth.value.psychologistId,
      },
      select: { id: true },
    });
    if (!source) return NextResponse.json({ error: 'Source session not found' }, { status: 404 });
  }

  // The Pass-5 brief is cached per (clientId, lastSessionId, language) — and
  // the brief for the NEXT visit may already be cached under the CURRENT
  // lastSessionId (Prepare opened early, or picks changed via "Change on
  // Review"). Changing the carried set must invalidate that cache, or the
  // next brief silently omits the questions the UI says are carried.
  const lastCompleted = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { endedAt: 'desc' },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await lockActiveClient(tx, clientId, auth.value.psychologistId);
    await tx.client.update({
      where: { id: clientId },
      data: { carriedQuestions: body.value.questions as unknown as Prisma.InputJsonValue },
    });
    // Only the session actively being edited changes its historical receipt.
    // Removing an older carried question must not reopen that older closeout.
    if (body.value.sourceSessionId) {
      const snapshot = body.value.questions.filter(
        (question) => question.sourceSessionId === body.value.sourceSessionId,
      ) as unknown as Prisma.InputJsonValue;
      await tx.mindSessionCloseoutState.upsert({
        where: { sessionId: body.value.sourceSessionId },
        create: { sessionId: body.value.sourceSessionId, nextQuestionsSnapshot: snapshot },
        update: { nextQuestionsSnapshot: snapshot, nextQuestionsSkippedAt: null },
      });
    }
    await tx.preSessionBrief.deleteMany({
      where: {
        clientId,
        psychologistId: auth.value.psychologistId,
        lastSessionId: lastCompleted?.id ?? null,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CARRIED_QUESTIONS_UPDATED',
        targetType: 'Client',
        targetId: clientId,
        metadata: {
          ...auditMetadataFromRequest(req),
          count: body.value.questions.length,
        },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true, count: body.value.questions.length }, { status: 200 });
}
