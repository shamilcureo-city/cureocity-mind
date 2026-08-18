import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { toSession } from '@/lib/mappers';
import { fetchOwnedSession } from '@/lib/session-helpers';
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
 * POST /api/v1/sessions/:id/end — transitions IN_PROGRESS → COMPLETED
 * and creates the empty NoteDraft row that PR 4 fills in synchronously
 * via Gemini two-pass.
 *
 * PR 3 just transitions state + creates the PENDING NoteDraft so the
 * client can poll for it. The actual generation kicks off in PR 4.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const existing = await fetchOwnedSession(auth.value.psychologistId, sessionId);
  if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (existing.status !== 'IN_PROGRESS') {
    return NextResponse.json(
      { error: `Cannot end a session in ${existing.status} state` },
      { status: 400 },
    );
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const row = await conditionalSessionTransition(tx, {
        sessionId,
        expectedStatus: 'IN_PROGRESS',
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_ENDED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: auditMetadataFromRequest(req),
        },
        tx,
      );
      await tx.noteDraft.upsert({
        where: { sessionId },
        create: { sessionId, status: 'PENDING' },
        update: {},
      });
      return row;
    });
  } catch (error) {
    const response = sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }
  return NextResponse.json(toSession(updated));
}
