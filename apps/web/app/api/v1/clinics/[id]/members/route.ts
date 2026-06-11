import { NextResponse, type NextRequest } from 'next/server';
import { AddClinicMemberInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { clinicRoleOf, isClinicAdminRole, toClinic } from '@/lib/clinic';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clinics/[id]/members — add a therapist to the clinic by
 * their registered email (OWNER/ADMIN only). Adding the first co-member
 * flips a SOLO clinic to GROUP. Visibility stays private — membership is
 * org-level only; it does not grant access to the member's clients.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clinicId } = await params;
  const input = await parseJson(req, AddClinicMemberInputSchema);
  if (!input.ok) return input.response;

  const myRole = await clinicRoleOf(clinicId, auth.value.psychologistId);
  if (!myRole) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
  if (!isClinicAdminRole(myRole)) {
    return NextResponse.json(
      { error: 'Only a clinic owner or admin can add members.' },
      { status: 403 },
    );
  }
  // Only an OWNER may seat another OWNER/ADMIN.
  const requestedRole = input.value.role ?? 'MEMBER';
  if (requestedRole !== 'MEMBER' && myRole !== 'OWNER') {
    return NextResponse.json(
      { error: 'Only an owner can grant an admin or owner role.' },
      { status: 403 },
    );
  }

  const invitee = await prisma.psychologist.findUnique({
    where: { email: input.value.email.toLowerCase() },
    select: { id: true, fullName: true, deletedAt: true },
  });
  if (!invitee || invitee.deletedAt) {
    return NextResponse.json(
      { error: 'No therapist with that email has signed up yet.' },
      { status: 404 },
    );
  }
  const already = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId, psychologistId: invitee.id } },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json({ error: 'That therapist is already a member.' }, { status: 409 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.clinicMembership.create({
      data: { clinicId, psychologistId: invitee.id, role: requestedRole },
    });
    // First co-member promotes a solo practice to a group clinic.
    await tx.clinic.updateMany({
      where: { id: clinicId, kind: 'SOLO' },
      data: { kind: 'GROUP' },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLINIC_MEMBER_ADDED',
        targetType: 'Clinic',
        targetId: clinicId,
        metadata: {
          ...auditMetadataFromRequest(req),
          psychologistId: invitee.id,
          role: requestedRole,
        },
      },
      tx,
    );
  });

  const refreshed = await prisma.clinic.findUnique({
    where: { id: clinicId },
    include: {
      memberships: {
        orderBy: { createdAt: 'asc' },
        include: { psychologist: { select: { fullName: true } } },
      },
    },
  });
  return NextResponse.json(
    { clinic: refreshed ? toClinic(refreshed, auth.value.psychologistId) : null },
    { status: 201 },
  );
}
