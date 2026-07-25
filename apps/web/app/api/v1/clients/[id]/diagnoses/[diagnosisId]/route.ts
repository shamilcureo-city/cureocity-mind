import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  RetireClientDiagnosisInputSchema,
  UpdateClientDiagnosisInputSchema,
  type ClientDiagnosisItem,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; diagnosisId: string }> };

function toItem(row: {
  id: string;
  icd11Code: string;
  icd11Label: string;
  isPrimary: boolean;
  notes: string | null;
  confirmedAt: Date;
  supersededAt: Date | null;
}): ClientDiagnosisItem {
  return {
    id: row.id,
    icd11Code: row.icd11Code,
    icd11Label: row.icd11Label,
    isPrimary: row.isPrimary,
    notes: row.notes,
    confirmedAt: row.confirmedAt.toISOString(),
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

/**
 * PATCH /api/v1/clients/[id]/diagnoses/[diagnosisId] — PC3.
 *
 * Correct a confirmed diagnosis in place: code, label, primary flag, note.
 * Previously a diagnosis could only be set by confirming a Pass-3 candidate,
 * so a mistyped code or a re-worded label meant a trip back through the
 * copilot.
 *
 * Promoting to primary demotes the client's current primary in the same
 * transaction — the schema's "exactly one isPrimary per client across
 * non-superseded rows" invariant is app-enforced, and this is one of the
 * places that has to hold it up.
 *
 * Superseded rows are history and are refused (409).
 */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, diagnosisId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, UpdateClientDiagnosisInputSchema);
  if (!dto.ok) return dto.response;

  const existing = await prisma.clientDiagnosis.findUnique({
    where: { id: diagnosisId },
    select: {
      clientId: true,
      psychologistId: true,
      supersededAt: true,
      icd11Code: true,
      isPrimary: true,
    },
  });
  if (!existing || existing.psychologistId !== psychologistId || existing.clientId !== clientId) {
    return NextResponse.json({ error: 'Diagnosis not found' }, { status: 404 });
  }
  if (existing.supersededAt !== null) {
    return NextResponse.json(
      { error: 'This diagnosis has been superseded and is part of the history.' },
      { status: 409 },
    );
  }

  const data: Prisma.ClientDiagnosisUpdateInput = {};
  if (dto.value.icd11Code !== undefined) data.icd11Code = dto.value.icd11Code.toUpperCase();
  if (dto.value.icd11Label !== undefined) data.icd11Label = dto.value.icd11Label;
  if (dto.value.notes !== undefined) data.notes = dto.value.notes;
  if (dto.value.isPrimary === true) data.isPrimary = true;

  const promoting = dto.value.isPrimary === true && !existing.isPrimary;

  const row = await prisma.$transaction(async (tx) => {
    if (promoting) {
      // Demote whichever live row currently holds primary for this client.
      await tx.clientDiagnosis.updateMany({
        where: { clientId, isPrimary: true, supersededAt: null, id: { not: diagnosisId } },
        data: { isPrimary: false },
      });
    }
    return tx.clientDiagnosis.update({ where: { id: diagnosisId }, data });
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'CLIENT_DIAGNOSIS_EDITED',
    targetType: 'ClientDiagnosis',
    targetId: row.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      previousCode: existing.icd11Code,
      code: row.icd11Code,
      promotedToPrimary: promoting,
      fields: Object.keys(data),
    },
  });

  return NextResponse.json({ diagnosis: toItem(row) });
}

/**
 * DELETE /api/v1/clients/[id]/diagnoses/[diagnosisId] — PC3.
 *
 * Retire a diagnosis that no longer holds. This is a supersede, never a
 * delete: the row keeps its evidence and stays in the Diagnosis History card,
 * so the record shows the clinical picture changing rather than losing a row.
 *
 * Retiring the primary leaves the client with no primary — deliberately. The
 * therapist promotes a successor rather than the server guessing one.
 */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId, diagnosisId } = await params;
  const psychologistId = auth.value.psychologistId;

  // A body is optional here (a reason, if the therapist gave one) and
  // `parseJson` rejects an empty one — DELETE is commonly sent without a
  // body, so parse defensively rather than 400-ing a well-formed request.
  let reason: string | null = null;
  const raw: unknown = await req.json().catch(() => null);
  if (raw !== null) {
    const parsed = RetireClientDiagnosisInputSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.flatten() },
        { status: 400 },
      );
    }
    reason = parsed.data.reason ?? null;
  }

  const existing = await prisma.clientDiagnosis.findUnique({
    where: { id: diagnosisId },
    select: {
      clientId: true,
      psychologistId: true,
      supersededAt: true,
      icd11Code: true,
      isPrimary: true,
    },
  });
  if (!existing || existing.psychologistId !== psychologistId || existing.clientId !== clientId) {
    return NextResponse.json({ error: 'Diagnosis not found' }, { status: 404 });
  }
  if (existing.supersededAt !== null) {
    return NextResponse.json({ error: 'Already retired.' }, { status: 409 });
  }

  const row = await prisma.clientDiagnosis.update({
    where: { id: diagnosisId },
    data: { supersededAt: new Date(), isPrimary: false },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'CLIENT_DIAGNOSIS_RETIRED',
    targetType: 'ClientDiagnosis',
    targetId: row.id,
    metadata: {
      ...auditMetadataFromRequest(req),
      clientId,
      code: row.icd11Code,
      wasPrimary: existing.isPrimary,
      reason,
    },
  });

  return NextResponse.json({ diagnosis: toItem(row) });
}
