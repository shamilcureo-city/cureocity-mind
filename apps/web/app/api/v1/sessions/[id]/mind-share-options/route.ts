import type { NextRequest } from 'next/server';
import type { MindOutcomeCandidate } from '@/lib/mind-care-loop';
import { requireCapability } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { privateJson, privateResponse } from '@/lib/private-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sharingAuth = await requireCapability(req, 'PATIENT_SHARING');
  if (!sharingAuth.ok) return privateResponse(sharingAuth.response);
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', sharingAuth);
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST')
    return privateJson({ error: 'Not found' }, { status: 404 });
  const { id } = await params;
  const session = await prisma.session.findFirst({
    where: {
      id,
      psychologistId: auth.value.psychologistId,
      status: 'COMPLETED',
      client: { is: { deletedAt: null, status: 'ACTIVE' } },
    },
    select: {
      id: true,
      clientId: true,
      kind: true,
      mindCloseout: { select: { patientTakeaway: true } },
      therapyNote: { select: { locked: true } },
    },
  });
  if (!session) return privateJson({ error: 'Session not found' }, { status: 404 });
  const [homework, plan] = await Promise.all([
    prisma.exerciseAssignment.findFirst({
      where: {
        clientId: session.clientId,
        psychologistId: auth.value.psychologistId,
        sourceSessionId: session.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      orderBy: { assignedAt: 'desc' },
      select: { id: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: {
        clientId: session.clientId,
        psychologistId: auth.value.psychologistId,
        supersededAt: null,
      },
      orderBy: { confirmedAt: 'desc' },
      select: { id: true },
    }),
  ]);
  const candidates: MindOutcomeCandidate[] = [];
  if (session.mindCloseout?.patientTakeaway?.trim())
    candidates.push({
      label: 'Session takeaway',
      artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: session.id },
      patientTakeaway: session.mindCloseout.patientTakeaway.trim(),
    });
  if (homework)
    candidates.push({
      label: 'Homework',
      artefact: { artefactType: 'HOMEWORK', assignmentId: homework.id, sessionId: session.id },
    });
  candidates.push({
    label: 'Next-session check-in',
    artefact: {
      artefactType: 'INSTRUMENT_CHECKIN',
      clientId: session.clientId,
      instrumentKey: 'PHQ9',
      sessionId: session.id,
    },
  });
  if (plan)
    candidates.push({
      label: 'Treatment-plan update',
      artefact: {
        artefactType: 'TREATMENT_PLAN',
        treatmentPlanId: plan.id,
        sessionId: session.id,
      },
    });
  if (session.therapyNote?.locked)
    candidates.push({
      label: 'Full signed note',
      secondary: true,
      artefact: {
        artefactType: session.kind === 'INTAKE' ? 'SIGNED_INTAKE_NOTE' : 'SIGNED_NOTE',
        sessionId: session.id,
      },
    });
  return privateJson({ candidates });
}
