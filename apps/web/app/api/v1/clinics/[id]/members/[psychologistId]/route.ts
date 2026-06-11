import { NextResponse, type NextRequest } from 'next/server';
import { UpdateClinicMemberInputSchema, type ClinicRole } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { clinicRoleOf, isClinicAdminRole, toClinic } from '@/lib/clinic';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Guard: requester must be OWNER/ADMIN; returns the role or an error response. */
async function requireAdminOfClinic(
  clinicId: string,
  psychologistId: string,
): Promise<{ ok: true; role: ClinicRole } | { ok: false; response: NextResponse }> {
  const role = await clinicRoleOf(clinicId, psychologistId);
  if (!role) {
    return { ok: false, response: NextResponse.json({ error: 'Clinic not found' }, { status: 404 }) };
  }
  if (!isClinicAdminRole(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Only a clinic owner or admin can manage members.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, role };
}

/** Block removing/demoting the clinic's last OWNER. */
async function isLastOwner(clinicId: string, psychologistId: string): Promise<boolean> {
  const target = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId, psychologistId } },
    select: { role: true },
  });
  if (target?.role !== 'OWNER') return false;
  const owners = await prisma.clinicMembership.count({ where: { clinicId, role: 'OWNER' } });
  return owners <= 1;
}

/**
 * PATCH /api/v1/clinics/[id]/members/[psychologistId] — change a member's
 * role. OWNER only (admins can't mint admins). Can't demote the last owner.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; psychologistId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clinicId, psychologistId: targetId } = await params;
  const input = await parseJson(req, UpdateClinicMemberInputSchema);
  if (!input.ok) return input.response;

  const guard = await requireAdminOfClinic(clinicId, auth.value.psychologistId);
  if (!guard.ok) return guard.response;
  if (guard.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only an owner can change roles.' }, { status: 403 });
  }
  const member = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId, psychologistId: targetId } },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (input.value.role !== 'OWNER' && (await isLastOwner(clinicId, targetId))) {
    return NextResponse.json(
      { error: 'Promote another owner before stepping this one down.' },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicMembership.update({
      where: { clinicId_psychologistId: { clinicId, psychologistId: targetId } },
      data: { role: input.value.role },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLINIC_MEMBER_ROLE_CHANGED',
        targetType: 'Clinic',
        targetId: clinicId,
        metadata: { ...auditMetadataFromRequest(req), psychologistId: targetId, role: input.value.role },
      },
      tx,
    );
  });
  return NextResponse.json(await clinicView(clinicId, auth.value.psychologistId));
}

/**
 * DELETE /api/v1/clinics/[id]/members/[psychologistId] — remove a member.
 * OWNER/ADMIN. Can't remove the last owner. Removing yourself is allowed
 * (leave the clinic) unless you're the last owner.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; psychologistId: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clinicId, psychologistId: targetId } = await params;

  const guard = await requireAdminOfClinic(clinicId, auth.value.psychologistId);
  if (!guard.ok) return guard.response;
  const member = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId, psychologistId: targetId } },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  if (await isLastOwner(clinicId, targetId)) {
    return NextResponse.json(
      { error: 'A clinic must keep at least one owner. Transfer ownership first.' },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicMembership.delete({
      where: { clinicId_psychologistId: { clinicId, psychologistId: targetId } },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLINIC_MEMBER_REMOVED',
        targetType: 'Clinic',
        targetId: clinicId,
        metadata: { ...auditMetadataFromRequest(req), psychologistId: targetId },
      },
      tx,
    );
  });
  return NextResponse.json(await clinicView(clinicId, auth.value.psychologistId));
}

async function clinicView(clinicId: string, viewerId: string) {
  const refreshed = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        include: { psychologist: { select: { fullName: true } } },
      },
    },
  });
  return { clinic: refreshed ? toClinic(refreshed, viewerId) : null };
}
