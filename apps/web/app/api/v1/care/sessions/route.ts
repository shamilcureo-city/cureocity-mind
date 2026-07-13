import { NextResponse, type NextRequest } from 'next/server';
import { StartCareSessionInputSchema } from '@cureocity/contracts';
import {
  CARE_LIVE_MODEL_ID,
  CARE_SESSION_CAP_MIN,
  CARE_START_TOKEN_TTL_SEC,
  CARE_THERAPIST_PROMPT_VERSION,
} from '@cureocity/llm';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { requireCareUserId } from '@/lib/care-auth';
import { getCareCaseFile, inferKindFromCaseFile } from '@/lib/care-case-file';
import { evaluateCareGate } from '@/lib/care-gate';
import { mintStartToken, putStartToken } from '@/lib/care-live-store';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/care/sessions (AC3) — start a session: the gate check
 * (safety hold / tier / weekly cap — the SAME pure function the home
 * card displays), server-side KIND inference (users never pick
 * "intake"), the CareSession row, and a single-use start token the
 * client redeems for the live credential.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCareUserId(req);
  if (!auth.ok) return auth.response;
  const { careUser, careUserId } = auth.value;
  const input = await parseJson(req, StartCareSessionInputSchema);
  if (!input.ok) return input.response;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const sessionsThisWeek = await prisma.careSession.count({
    where: {
      careUserId,
      createdAt: { gte: weekAgo },
      status: { in: ['COMPLETED', 'IN_PROGRESS'] },
    },
  });
  const gate = evaluateCareGate({
    status: careUser.status,
    onboardedAt: careUser.onboardedAt,
    planTier: careUser.planTier,
    sessionsThisWeek,
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.reason, code: gate.code }, { status: 403 });
  }

  const caseFile = await getCareCaseFile(careUserId);
  const kind = inferKindFromCaseFile(caseFile);
  const backend = process.env['CARE_LIVE_BACKEND'] ?? 'mock';

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.careSession.create({
      data: {
        careUserId,
        kind,
        carePlanId: caseFile.plan?.id ?? null,
        topic: input.value.topic ?? null,
        moodBefore: input.value.moodBefore ?? null,
        model: backend === 'mock' ? 'mock-live' : CARE_LIVE_MODEL_ID,
        promptVersion: CARE_THERAPIST_PROMPT_VERSION,
      },
      select: { id: true, kind: true },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'CARE_SESSION_STARTED',
        targetType: 'CareSession',
        targetId: created.id,
        metadata: { ...auditMetadataFromRequest(req), kind, backend },
      },
      tx,
    );
    return created;
  });

  const startToken = mintStartToken();
  await putStartToken(startToken, {
    careSessionId: session.id,
    careUserId,
    expiresAtMs: Date.now() + CARE_START_TOKEN_TTL_SEC * 1000,
  });

  return NextResponse.json({
    sessionId: session.id,
    kind: session.kind,
    startToken,
    sessionCapMin: CARE_SESSION_CAP_MIN[kind],
  });
}
