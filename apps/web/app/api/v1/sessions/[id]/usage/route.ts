import type { NextRequest } from 'next/server';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { privateJson, privateResponse } from '@/lib/private-response';
import { prisma } from '@/lib/prisma';
import { ClientPhiWriteForbiddenError, withActiveSessionPhiWrite } from '@/lib/phi-write-lock';
import { loadRecordedUsage, summarizeSessionUsage } from '@/lib/session-usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The compatible reader remains available when new receipt reporting is disabled. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const identity = await requirePsychologistId(req);
  if (!identity.ok) return privateResponse(identity.response);
  const capability =
    identity.value.user.vertical === 'DOCTOR'
      ? 'MEDICAL_DOCUMENTATION'
      : 'BEHAVIORAL_HEALTH_DOCUMENTATION';
  const auth = await requireCapability(req, capability, identity);
  if (!auth.ok) return privateResponse(auth.response);
  const { id: sessionId } = await params;
  try {
    return await withActiveSessionPhiWrite(
      prisma,
      sessionId,
      auth.value.psychologistId,
      async (tx) => {
        const source = await loadRecordedUsage(
          { sessionId, psychologistId: auth.value.psychologistId },
          tx,
        );
        return privateJson(
          summarizeSessionUsage(
            sessionId,
            source.calls,
            source.connections,
            source.storageAvailable,
          ),
        );
      },
    );
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError)
      return privateJson({ error: 'Session not found' }, { status: 404 });
    return privateJson(
      {
        error:
          'The recorded estimate could not be read. It has not been replaced with zero. Try again.',
      },
      { status: 503 },
    );
  }
}
