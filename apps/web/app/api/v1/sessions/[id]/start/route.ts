import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';
import {
  assertValidScribeConsent,
  consentAuthorizationResponse,
  withClientConsentLock,
} from '@/lib/consent-gate';
import {
  conditionalSessionTransition,
  sessionConcurrentModificationResponse,
} from '@/lib/session-transition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/v1/sessions/:id/start — transitions SCHEDULED → IN_PROGRESS.
 * Refuses without a recorded consent snapshot.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'SCHEDULED') {
    return NextResponse.json(
      { error: `Cannot start a session in ${existing.status} state` },
      { status: 400 },
    );
  }

  // DS11.7 — the doctor capture surfaces declare their pipeline. Optional
  // body; therapist callers send none and captureMode stays null.
  const body = (await req.json().catch(() => null)) as { captureMode?: string } | null;
  const captureMode =
    body?.captureMode === 'DICTATE' || body?.captureMode === 'UPLOAD' ? body.captureMode : null;

  let updated;
  try {
    updated = await prisma.$transaction((tx) =>
      withClientConsentLock(tx, existing.clientId, async () => {
        const current = await tx.session.findUnique({
          where: { id: sessionId },
          select: { consentSnapshot: true },
        });
        await assertValidScribeConsent(current?.consentSnapshot ?? null, existing.clientId, tx);

        const row = await conditionalSessionTransition(tx, {
          sessionId,
          expectedStatus: 'SCHEDULED',
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            ...(captureMode && { captureMode }),
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'SESSION_STARTED',
            targetType: 'Session',
            targetId: sessionId,
            metadata: auditMetadataFromRequest(req),
          },
          tx,
        );
        return row;
      }),
    );
  } catch (error) {
    const response =
      consentAuthorizationResponse(error) ?? sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }
  return NextResponse.json(toSession(updated));
}
