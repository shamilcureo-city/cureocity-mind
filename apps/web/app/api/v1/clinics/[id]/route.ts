import { NextResponse, type NextRequest } from 'next/server';
import { UpdateClinicInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toClinic } from '@/lib/clinic';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/clinics/[id] — rename a clinic.
 *
 * Restricted to OWNER / ADMIN of that clinic. Phase 1 only exposes
 * rename; member management (add / remove / role change) is Phase 2.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const input = await parseJson(req, UpdateClinicInputSchema);
  if (!input.ok) return input.response;

  const membership = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId: id, psychologistId: auth.value.psychologistId } },
    select: { role: true },
  });
  if (!membership) {
    return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
  }
  if (membership.role !== 'OWNER' && membership.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Only a clinic owner or admin can rename it.' },
      { status: 403 },
    );
  }

  await prisma.clinic.update({ where: { id }, data: { name: input.value.name } });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'PSYCHOLOGIST_UPDATED',
    targetType: 'Clinic',
    targetId: id,
    metadata: { ...auditMetadataFromRequest(req), event: 'CLINIC_RENAMED', name: input.value.name },
  });

  const refreshed = await prisma.clinic.findUnique({
    where: { id },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        include: { psychologist: { select: { fullName: true } } },
      },
    },
  });
  return NextResponse.json({
    clinic: refreshed ? toClinic(refreshed, auth.value.psychologistId) : null,
  });
}
