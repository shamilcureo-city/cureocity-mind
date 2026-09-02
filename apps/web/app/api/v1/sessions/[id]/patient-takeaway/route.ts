import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { privateJson, privateResponse } from '@/lib/private-response';

const Input = z.object({ summary: z.string().trim().min(1).max(2000) }).strict();

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sharingAuth = await requireCapability(req, 'PATIENT_SHARING');
  if (!sharingAuth.ok) return privateResponse(sharingAuth.response);
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', sharingAuth);
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST')
    return privateJson({ error: 'Not found' }, { status: 404 });
  const body = await parseJson(req, Input);
  if (!body.ok) return privateResponse(body.response);
  const { id } = await params;
  let persisted: boolean;
  try {
    persisted = await prisma.$transaction(async (tx) => {
      const client = await lockActiveClientForSession(tx, id, auth.value.psychologistId);
      const session = await tx.session.findFirst({
        where: {
          id,
          clientId: client.id,
          psychologistId: auth.value.psychologistId,
          status: 'COMPLETED',
          client: { is: { deletedAt: null, status: 'ACTIVE' } },
          therapyNote: { is: { locked: true } },
        },
        select: { id: true },
      });
      if (!session) return false;
      await tx.mindSessionCloseoutState.upsert({
        where: { sessionId: id },
        create: { sessionId: id, patientTakeaway: body.value.summary },
        update: { patientTakeaway: body.value.summary },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'MIND_CLOSEOUT_DECISION_RECORDED',
          targetType: 'MindSessionCloseoutState',
          targetId: id,
          metadata: { ...auditMetadataFromRequest(req), step: 'patientTakeaway' },
        },
        tx,
      );
      return true;
    });
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) persisted = false;
    else throw error;
  }
  if (!persisted) return privateJson({ error: 'Session not found' }, { status: 404 });
  return privateJson({ ok: true });
}
