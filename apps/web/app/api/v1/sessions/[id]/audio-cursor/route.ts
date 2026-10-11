import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId, requireCapability } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { assertValidScribeConsent, consentAuthorizationResponse } from '@/lib/consent-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reconcile a browser-local cursor with acknowledged server audio before any
 * new microphone is opened. Concurrent writers still face byte-checked upload
 * conflicts; reading this cursor is not an exclusive recording lease. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const capability = await requireCapability(
    req,
    auth.value.user.vertical === 'DOCTOR'
      ? 'MEDICAL_DOCUMENTATION'
      : 'BEHAVIORAL_HEALTH_DOCUMENTATION',
    auth,
  );
  if (!capability.ok) return capability.response;
  const { id: sessionId } = await params;
  try {
    const cursor = await prisma.$transaction(async (tx) => {
      const client = await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          clientId: true,
          psychologistId: true,
          status: true,
          mindDocumentationMode: true,
          consentSnapshot: true,
        },
      });
      if (
        !session ||
        session.clientId !== client.id ||
        session.psychologistId !== auth.value.psychologistId
      )
        throw new ClientPhiWriteForbiddenError();
      if (
        !['SCHEDULED', 'IN_PROGRESS'].includes(session.status) ||
        session.mindDocumentationMode === 'MANUAL'
      )
        return null;
      await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
      const last = await tx.audioChunk.findFirst({
        where: { sessionId },
        orderBy: { chunkIndex: 'desc' },
        select: { chunkIndex: true },
      });
      return { nextChunkIndex: last ? last.chunkIndex + 1 : 0 };
    });
    if (!cursor)
      return NextResponse.json(
        { error: 'This session is not open for recording.' },
        { status: 409 },
      );
    return NextResponse.json(cursor, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const consent = consentAuthorizationResponse(error);
    if (consent) return consent;
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    return NextResponse.json(
      { error: 'Could not verify saved audio. Keep capture off and retry.' },
      { status: 503 },
    );
  }
}
