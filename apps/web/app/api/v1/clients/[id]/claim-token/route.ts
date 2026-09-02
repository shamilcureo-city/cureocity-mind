import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { privateJson, privateResponse } from '@/lib/private-response';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(req, 'PATIENT_SHARING');
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST')
    return privateJson({ error: 'Not found' }, { status: 404 });
  const { id } = await params;
  const expiresAt = new Date(Date.now() + 14 * 86_400_000);
  const row = await prisma
    .$transaction(async (tx) => {
      const clients = await tx.$queryRaw<
        Array<{
          id: string;
          psychologistId: string;
          clientFirebaseUid: string | null;
          contactPhoneEncrypted: string | null;
          deletedAt: Date | null;
          status: 'ACTIVE' | 'PAUSED' | 'DISCHARGED' | 'TRANSFERRED';
          vertical: 'THERAPIST' | 'DOCTOR';
        }>
      >`
        SELECT c."id", c."psychologistId", c."clientFirebaseUid",
               c."contactPhoneEncrypted", c."deletedAt", c."status", p."vertical"
        FROM "clients" c
        JOIN "psychologists" p ON p."id" = c."psychologistId"
        WHERE c."id" = ${id}
        FOR UPDATE OF c
      `;
      const client = clients[0];
      if (
        !client ||
        client.psychologistId !== auth.value.psychologistId ||
        client.vertical !== 'THERAPIST' ||
        client.deletedAt !== null ||
        client.status !== 'ACTIVE'
      )
        throw new ClaimIssueError('Client not found', 404);
      if (!client.contactPhoneEncrypted)
        throw new ClaimIssueError('Care access requires a verified client phone', 409);
      if (client.clientFirebaseUid)
        throw new ClaimIssueError('Care access is already claimed', 409);

      // A newly issued token supersedes every prior active token without
      // falsifying redemption history.
      await tx.clientClaimToken.updateMany({
        where: { clientId: id, redeemedAt: null, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      const created = await tx.clientClaimToken.create({
        data: {
          clientId: id,
          psychologistId: auth.value.psychologistId,
          token: randomBytes(16).toString('base64url'),
          expiresAt,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CLIENT_CLAIM_TOKEN_ISSUED',
          targetType: 'ClientClaimToken',
          targetId: created.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: id,
            outcome: 'issued',
          },
        },
        tx,
      );
      return created;
    })
    .catch((error: unknown) => {
      if (error instanceof ClaimIssueError) return error;
      throw error;
    });
  if (row instanceof ClaimIssueError)
    return privateJson({ error: row.message }, { status: row.status });
  return privateJson(
    {
      token: row.token,
      clientId: row.clientId,
      psychologistId: row.psychologistId,
      expiresAt: row.expiresAt.toISOString(),
    },
    { status: 201 },
  );
}

class ClaimIssueError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
