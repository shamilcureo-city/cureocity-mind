import { NextResponse, type NextRequest } from 'next/server';
import { ReassignClientInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import {
  clinicRoleOf,
  isClinicAdminRole,
  transferAllCustody,
  transferClientCustody,
} from '@/lib/clinic';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The custody transfer touches ~16 tables; give it headroom.
export const maxDuration = 60;

/**
 * POST /api/v1/clinics/[id]/reassign — move a client's custody from one
 * clinic member to another (OWNER/ADMIN only).
 *
 * Both the current owner and the target must be members of THIS clinic, so
 * a reassignment never crosses a clinic boundary. The transfer moves
 * Client.psychologistId + every client-scoped owned table so the new
 * therapist gets full continuity; immutable authorship (signedBy /
 * confirmedBy / audit rows) is preserved. Audited as CLIENT_REASSIGNED.
 *
 * Note this is the only Phase 2 path that mutates client ownership — the
 * admin still never *reads* the client's clinical content.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clinicId } = await params;
  const input = await parseJson(req, ReassignClientInputSchema);
  if (!input.ok) return input.response;

  const myRole = await clinicRoleOf(clinicId, auth.value.psychologistId);
  if (!myRole) return NextResponse.json({ error: 'Clinic not found' }, { status: 404 });
  if (!isClinicAdminRole(myRole)) {
    return NextResponse.json(
      { error: 'Only a clinic owner or admin can reassign clients.' },
      { status: 403 },
    );
  }

  const toRole = await clinicRoleOf(clinicId, input.value.toPsychologistId);
  if (!toRole) {
    return NextResponse.json(
      { error: 'The target therapist is not a member of this clinic.' },
      { status: 400 },
    );
  }

  // ---- Single-client mode --------------------------------------------------
  if (input.value.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: input.value.clientId },
      select: { id: true, psychologistId: true, deletedAt: true },
    });
    if (!client || client.deletedAt) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }
    if (client.psychologistId === input.value.toPsychologistId) {
      return NextResponse.json(
        { error: 'Client is already assigned to that therapist.' },
        { status: 409 },
      );
    }
    if (!(await clinicRoleOf(clinicId, client.psychologistId))) {
      return NextResponse.json(
        { error: 'This client is not held by a member of this clinic.' },
        { status: 403 },
      );
    }
    const fromPsychologistId = client.psychologistId;
    await prisma.$transaction(async (tx) => {
      await transferClientCustody(tx, {
        clientId: client.id,
        toPsychologistId: input.value.toPsychologistId,
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CLIENT_REASSIGNED',
          targetType: 'Client',
          targetId: client.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clinicId,
            mode: 'one',
            fromPsychologistId,
            toPsychologistId: input.value.toPsychologistId,
          },
        },
        tx,
      );
    });
    return NextResponse.json({
      ok: true,
      moved: 1,
      toPsychologistId: input.value.toPsychologistId,
    });
  }

  // ---- Whole-caseload mode (departure) ------------------------------------
  const fromId = input.value.fromPsychologistId!;
  if (fromId === input.value.toPsychologistId) {
    return NextResponse.json({ error: 'Pick two different therapists.' }, { status: 400 });
  }
  if (!(await clinicRoleOf(clinicId, fromId))) {
    return NextResponse.json(
      { error: 'The departing therapist is not a member of this clinic.' },
      { status: 400 },
    );
  }
  const moved = await prisma.$transaction(async (tx) => {
    const count = await transferAllCustody(tx, {
      fromPsychologistId: fromId,
      toPsychologistId: input.value.toPsychologistId,
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_REASSIGNED',
        targetType: 'Psychologist',
        targetId: fromId,
        metadata: {
          ...auditMetadataFromRequest(req),
          clinicId,
          mode: 'all',
          fromPsychologistId: fromId,
          toPsychologistId: input.value.toPsychologistId,
          clientsMoved: count,
        },
      },
      tx,
    );
    return count;
  });

  return NextResponse.json({ ok: true, moved, toPsychologistId: input.value.toPsychologistId });
}
