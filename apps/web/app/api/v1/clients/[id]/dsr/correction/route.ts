import { NextResponse, type NextRequest } from 'next/server';
import { DsrCorrectionInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toClient } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/clients/[id]/dsr/correction — DPDP § 12 Right to
 * Correction. Therapist applies the field changes the client
 * requested. Same shape as the regular client PATCH, but lands as
 * DSR_CORRECTION_REQUESTED in the audit log so the regulator can
 * distinguish DPDP-driven edits from routine clinical updates.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const body = await parseJson(req, DsrCorrectionInputSchema);
  if (!body.ok) return body.response;

  const existing = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // S32 Phase 1 — DPDP correction is the same write surface as PATCH
  // /clients, so dual-write the encrypted PII columns identically.
  // Sprint 54 — fullName joins the dual-write set; DPDP correction is
  // the same write surface as PATCH /clients.
  const fullNameEncrypted =
    body.value.fullName !== undefined
      ? await encryptForTenant(auth.value.psychologistId, body.value.fullName)
      : undefined;
  const contactPhoneEncrypted =
    body.value.contactPhone !== undefined
      ? await encryptForTenant(auth.value.psychologistId, body.value.contactPhone)
      : undefined;
  const contactEmailEncrypted =
    body.value.contactEmail !== undefined
      ? body.value.contactEmail
        ? await encryptForTenant(auth.value.psychologistId, body.value.contactEmail)
        : null
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.client.update({
      where: { id: clientId },
      data: {
        ...(body.value.fullName !== undefined && { fullName: body.value.fullName }),
        ...(fullNameEncrypted !== undefined && { fullNameEncrypted }),
        ...(body.value.contactPhone !== undefined && { contactPhone: body.value.contactPhone }),
        ...(contactPhoneEncrypted !== undefined && { contactPhoneEncrypted }),
        ...(body.value.contactEmail !== undefined && { contactEmail: body.value.contactEmail }),
        ...(contactEmailEncrypted !== undefined && { contactEmailEncrypted }),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'DSR_CORRECTION_REQUESTED',
        targetType: 'Client',
        targetId: clientId,
        metadata: {
          ...auditMetadataFromRequest(req),
          onBehalfOf: clientId,
          reason: body.value.reason,
          fieldsChanged: Object.keys(body.value).filter((k) => k !== 'reason'),
        },
      },
      tx,
    );
    return next;
  });

  return NextResponse.json(toClient(updated));
}
