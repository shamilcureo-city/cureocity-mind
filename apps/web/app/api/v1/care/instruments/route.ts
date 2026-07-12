import { NextResponse, type NextRequest } from 'next/server';
import { CareInstrumentInputSchema } from '@cureocity/contracts';
import { INSTRUMENTS, InstrumentScoringError, scoreInstrument } from '@cureocity/clinical';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { crisisResources } from '@/lib/care-safety';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/instruments (AC5) — PHQ-9 / GAD-7 self check-ins.
 * Items + scoring come from the @cureocity/clinical registry (framed in
 * the UI as check-ins, never diagnosis). §2 layer 6: a flagged PHQ-9
 * item 9 (> 0) trips the safety hold IMMEDIATELY — same path as a live
 * crisis, because a scored disclosure is still a disclosure.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const input = await parseJson(req, CareInstrumentInputSchema);
  if (!input.ok) return input.response;

  const definition = INSTRUMENTS[input.value.instrumentKey];
  let score;
  try {
    score = scoreInstrument(definition, input.value.answers);
  } catch (e) {
    if (e instanceof InstrumentScoringError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  const riskItemId =
    definition.riskItemNumber !== undefined
      ? definition.items[definition.riskItemNumber - 1]?.id
      : undefined;
  const item9 = riskItemId !== undefined ? (input.value.answers[riskItemId] ?? null) : null;

  const response = await prisma.$transaction(async (tx) => {
    const created = await tx.careInstrumentResponse.create({
      data: {
        careUserId: auth.value.careUserId,
        instrumentKey: input.value.instrumentKey,
        answers: input.value.answers,
        totalScore: score.score,
        item9,
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_INSTRUMENT_SUBMITTED',
        targetType: 'CareInstrumentResponse',
        targetId: created.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          instrumentKey: input.value.instrumentKey,
          totalScore: score.score,
          severityKey: score.severityKey,
          riskFlagged: score.riskFlagged,
        },
      },
      tx,
    );
    if (score.riskFlagged && auth.value.careUser.status === 'ACTIVE') {
      await tx.careUser.update({
        where: { id: auth.value.careUserId },
        data: { status: 'SAFETY_HOLD', safetyHoldAt: new Date() },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'CARE_SAFETY_HOLD_SET',
          targetType: 'CareUser',
          targetId: auth.value.careUserId,
          metadata: { cause: 'INSTRUMENT_RISK_ITEM', instrumentKey: input.value.instrumentKey },
        },
        tx,
      );
    }
    return created;
  });

  return NextResponse.json({
    id: response.id,
    totalScore: score.score,
    severityKey: score.severityKey,
    severityLabel: score.severityLabel,
    safetyHold: score.riskFlagged,
    ...(score.riskFlagged
      ? { resources: crisisResources(auth.value.careUser.spokenLanguages) }
      : {}),
  });
}
