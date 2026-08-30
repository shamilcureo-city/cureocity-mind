import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DecisionSchema = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('clinicalSuggestions'),
    outcome: z.enum(['COMPLETE', 'SKIPPED']),
  }),
  z.object({
    step: z.enum(['agreements', 'nextSessionQuestions', 'shared', 'followUp']),
    outcome: z.literal('SKIPPED'),
  }),
]);

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const dto = await parseJson(req, DecisionSchema);
  if (!dto.ok) return dto.response;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      psychologistId: auth.value.psychologistId,
      status: 'COMPLETED',
    },
    select: { id: true, psychologist: { select: { vertical: true } } },
  });
  if (!session || session.psychologist.vertical === 'DOCTOR') {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const now = new Date();
  const data =
    dto.value.step === 'clinicalSuggestions'
      ? dto.value.outcome === 'COMPLETE'
        ? { clinicalSuggestionsResolvedAt: now, clinicalSuggestionsSkippedAt: null }
        : { clinicalSuggestionsSkippedAt: now, clinicalSuggestionsResolvedAt: null }
      : dto.value.step === 'agreements'
        ? { agreementsSkippedAt: now }
        : dto.value.step === 'nextSessionQuestions'
          ? { nextQuestionsSkippedAt: now }
          : dto.value.step === 'shared'
            ? { shareSkippedAt: now }
            : { followUpSkippedAt: now };

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${sessionId}))`;
    if (dto.value.step === 'followUp') {
      const existing = await tx.mindSessionCloseoutState.findUnique({ where: { sessionId } });
      if (existing?.followUpSessionId) return null;
    }

    const state = await tx.mindSessionCloseoutState.upsert({
      where: { sessionId },
      create: { sessionId, ...data },
      update: data,
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'MIND_CLOSEOUT_DECISION_RECORDED',
        targetType: 'MindSessionCloseoutState',
        targetId: sessionId,
        metadata: {
          ...auditMetadataFromRequest(req),
          step: dto.value.step,
          outcome: dto.value.outcome,
        },
      },
      tx,
    );
    return state;
  });

  if (!result) {
    return NextResponse.json({ error: 'A follow-up is already scheduled' }, { status: 409 });
  }
  return NextResponse.json(result);
}
