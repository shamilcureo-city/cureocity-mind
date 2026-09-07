import { NextResponse, type NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { assertValidScribeConsent, consentAuthorizationResponse } from '@/lib/consent-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class ResumeConflict extends Error {}
function privateResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

/** Reauthorize a paused Mind capture without restarting or modifying the visit. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') {
    return privateResponse(NextResponse.json({ error: 'Session not found' }, { status: 404 }));
  }
  const { id: sessionId } = await params;
  try {
    await prisma.$transaction(async (tx) => {
      // The same Client row serializes against end, erasure and withdrawal.
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          clientId: true,
          psychologistId: true,
          status: true,
          consentSnapshot: true,
          psychologist: { select: { vertical: true, status: true, deletedAt: true } },
        },
      });
      if (
        !session ||
        session.clientId !== client.id ||
        session.psychologistId !== auth.value.psychologistId ||
        session.psychologist.vertical !== 'THERAPIST' ||
        session.psychologist.status !== 'ACTIVE' ||
        session.psychologist.deletedAt !== null
      )
        throw new ClientPhiWriteForbiddenError();
      if (session.status !== 'IN_PROGRESS') {
        throw new ResumeConflict(
          'This session is not open for recording. Return to the session to check its status.',
        );
      }
      await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
      // No status, timestamp, consent snapshot, draft or audit mutation here.
    });
    return privateResponse(NextResponse.json({ authorized: true }));
  } catch (error) {
    const consent = consentAuthorizationResponse(error);
    if (consent) return privateResponse(consent);
    if (error instanceof ClientPhiWriteForbiddenError) {
      return privateResponse(NextResponse.json({ error: 'Session not found' }, { status: 404 }));
    }
    if (error instanceof ResumeConflict) {
      return privateResponse(NextResponse.json({ error: error.message }, { status: 409 }));
    }
    return privateResponse(
      NextResponse.json(
        { error: 'Recording could not be reauthorized. Keep capture paused and try again.' },
        { status: 503 },
      ),
    );
  }
}
