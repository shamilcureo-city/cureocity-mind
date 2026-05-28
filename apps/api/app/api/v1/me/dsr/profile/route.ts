import { NextResponse, type NextRequest } from 'next/server';
import { DsrCorrectionInputSchema } from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/v1/me/dsr/profile — DPDP § 12 correction. Records the
 * old + new values in the audit row so an auditor can answer "what
 * did the client correct?" without DB diff archaeology.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, DsrCorrectionInputSchema);
  if (!dto.ok) return dto.response;
  const clientId = auth.value.clientId;

  const existing = await prisma.client.findUnique({
    where: { id: clientId },
    select: { fullName: true, contactPhone: true, contactEmail: true },
  });
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        ...(dto.value.fullName !== undefined && { fullName: dto.value.fullName }),
        ...(dto.value.contactPhone !== undefined && { contactPhone: dto.value.contactPhone }),
        ...(dto.value.contactEmail !== undefined && { contactEmail: dto.value.contactEmail }),
      },
    });
    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'DSR_CORRECTION_REQUESTED',
        targetType: 'Client',
        targetId: clientId,
        metadata: {
          ...auditMetadataFromRequest(req),
          before: existing,
          after: {
            fullName: dto.value.fullName ?? existing.fullName,
            contactPhone: dto.value.contactPhone ?? existing.contactPhone,
            contactEmail:
              dto.value.contactEmail === undefined ? existing.contactEmail : dto.value.contactEmail,
          },
          reason: dto.value.reason,
        },
      },
      tx,
    );
  });
  return new NextResponse(null, { status: 204 });
}
