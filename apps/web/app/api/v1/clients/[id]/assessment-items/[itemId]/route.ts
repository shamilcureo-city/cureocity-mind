import { NextResponse, type NextRequest } from 'next/server';
import { UpdateAssessmentItemInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { toAssessmentItem } from '../route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/clients/[id]/assessment-items/[itemId]
 *
 * Sprint 22 — move an assessment item through OPEN → ADDRESSED → CLOSED.
 * Closing captures the therapist's one-line finding and the session it
 * was resolved in, and audits ASSESSMENT_ITEM_CLOSED.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, itemId } = await params;

  const dto = await parseJson(req, UpdateAssessmentItemInputSchema);
  if (!dto.ok) return dto.response;

  const item = await prisma.assessmentItem.findUnique({
    where: { id: itemId },
    select: { id: true, clientId: true, psychologistId: true, status: true },
  });
  if (!item || item.clientId !== clientId || item.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Assessment item not found' }, { status: 404 });
  }

  const closing = dto.value.status === 'CLOSED';
  const updated = await prisma.assessmentItem.update({
    where: { id: itemId },
    data: {
      status: dto.value.status,
      ...(dto.value.resolutionNote !== undefined && {
        resolutionNote: dto.value.resolutionNote,
      }),
      ...(dto.value.addressedSessionId !== undefined && {
        addressedSessionId: dto.value.addressedSessionId,
      }),
      closedAt: closing ? new Date() : null,
    },
  });

  if (closing) {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'ASSESSMENT_ITEM_CLOSED',
      targetType: 'AssessmentItem',
      targetId: itemId,
      metadata: {
        ...auditMetadataFromRequest(req),
        clientId,
        resolutionNote: dto.value.resolutionNote ?? null,
      },
    });
  }

  return NextResponse.json({ item: toAssessmentItem(updated) });
}
