import { NextResponse, type NextRequest } from 'next/server';
import { PatientShareTokenSchema } from '@cureocity/contracts';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { lockShareFamily } from '@/lib/share-family-lock';

const GENERIC = {
  accepted: true,
  message: 'If this link can be refreshed, the care team will see your request.',
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = PatientShareTokenSchema.safeParse(token);
  if (!parsed.success) return NextResponse.json(GENERIC, { status: 202 });
  const share = await prisma.patientShare.findUnique({
    where: { shareToken: parsed.data },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      status: true,
      expiresAt: true,
      resendOfId: true,
      shareBatchId: true,
      psychologist: { select: { vertical: true } },
    },
  });
  const now = new Date();
  if (!share || share.psychologist.vertical !== 'THERAPIST') {
    return NextResponse.json(GENERIC, { status: 202 });
  }
  const rootId = await findShareFamilyRoot(share.id, share.resendOfId);
  const cooldown = new Date(now.getTime() - 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await lockShareFamily(tx, { id: rootId, shareBatchId: share.shareBatchId });
    const [latest] = await tx.$queryRaw<
      Array<{
        id: string;
        clientId: string;
        psychologistId: string;
      }>
    >`
      WITH RECURSIVE descendants AS (
        SELECT "id", "clientId", "psychologistId", "status", "expiresAt", "createdAt"
        FROM "patient_shares" WHERE "id" = ${rootId}
        UNION ALL
        SELECT child."id", child."clientId", child."psychologistId", child."status", child."expiresAt", child."createdAt"
        FROM "patient_shares" child
        JOIN descendants parent ON child."resendOfId" = parent."id"
      )
      SELECT "id", "clientId", "psychologistId" FROM descendants
      WHERE "status" IN ('SENT', 'OPENED') AND "expiresAt" <= ${now}
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 1
    `;
    if (!latest) return;
    const changed = await tx.patientShare.updateMany({
      where: {
        id: latest.id,
        status: { in: ['SENT', 'OPENED'] },
        expiresAt: { lte: now },
        OR: [{ refreshRequestedAt: null }, { refreshRequestedAt: { lt: cooldown } }],
      },
      data: { refreshRequestedAt: new Date(), refreshRequestCount: { increment: 1 } },
    });
    if (changed.count === 1) {
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'PATIENT_SHARE_REFRESH_REQUESTED',
          targetType: 'PatientShare',
          targetId: latest.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: latest.clientId,
            psychologistId: latest.psychologistId,
          },
        },
        tx,
      );
    }
  });
  return NextResponse.json(GENERIC, { status: 202 });
}

async function findShareFamilyRoot(id: string, parentId: string | null): Promise<string> {
  let rootId = id;
  let nextParent = parentId;
  while (nextParent) {
    rootId = nextParent;
    const parent = await prisma.patientShare.findUnique({
      where: { id: nextParent },
      select: { resendOfId: true },
    });
    nextParent = parent?.resendOfId ?? null;
  }
  return rootId;
}
