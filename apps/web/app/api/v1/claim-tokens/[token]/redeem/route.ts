import { NextResponse, type NextRequest } from 'next/server';
import { PatientShareTokenSchema } from '@cureocity/contracts';
import { resolveFirebaseClaimIdentity } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { claimPhoneMatches } from '@/lib/client-claim-phone';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const auth = await resolveFirebaseClaimIdentity(req);
  if (!auth.ok) return privateResponse(auth.response);
  const { token } = await params;
  if (!PatientShareTokenSchema.safeParse(token).success)
    return privateJson({ error: 'Claim not found' }, { status: 404 });
  // Never turn a client login into a practitioner identity or accept an
  // ambiguous dual-role Firebase UID.
  if (
    await prisma.psychologist.findUnique({
      where: { firebaseUid: auth.value.firebaseUid },
      select: { id: true },
    })
  ) {
    return privateJson({ error: 'Claim not found' }, { status: 404 });
  }
  const preliminaryClaim = await prisma.clientClaimToken.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          id: true,
          psychologistId: true,
          contactPhoneEncrypted: true,
          deletedAt: true,
          status: true,
          psychologist: { select: { vertical: true } },
        },
      },
    },
  });
  if (
    !preliminaryClaim ||
    preliminaryClaim.supersededAt !== null ||
    preliminaryClaim.expiresAt <= new Date() ||
    preliminaryClaim.client.deletedAt ||
    preliminaryClaim.client.status !== 'ACTIVE' ||
    preliminaryClaim.client.psychologist.vertical !== 'THERAPIST' ||
    preliminaryClaim.psychologistId !== preliminaryClaim.client.psychologistId
  )
    return privateJson({ error: 'Claim not found' }, { status: 404 });

  // Phone decryption may use KMS and must complete before the short database
  // transaction. The locked Client reread below binds this result to the exact
  // encrypted phone value that was verified here.
  if (
    !(await claimPhoneMatches({
      psychologistId: preliminaryClaim.psychologistId,
      contactPhoneEncrypted: preliminaryClaim.client.contactPhoneEncrypted,
      verifiedPhoneNumber: auth.value.phoneNumber,
    }))
  )
    return privateJson({ error: 'Claim not found' }, { status: 404 });

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // Match erasure/assignment lock order: the Client row is always first.
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
          WHERE c."id" = ${preliminaryClaim.clientId}
          FOR UPDATE OF c
        `;
        const client = clients[0];
        if (
          !client ||
          client.psychologistId !== preliminaryClaim.psychologistId ||
          client.vertical !== 'THERAPIST' ||
          client.deletedAt !== null ||
          client.status !== 'ACTIVE' ||
          client.contactPhoneEncrypted !== preliminaryClaim.client.contactPhoneEncrypted
        )
          throw new ClaimNotFound();

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`firebase-role:${auth.value.firebaseUid}`}))`;
        if (
          await tx.psychologist.findUnique({
            where: { firebaseUid: auth.value.firebaseUid },
            select: { id: true },
          })
        )
          throw new ClaimNotFound();

        const claim = await tx.clientClaimToken.findUnique({ where: { token } });
        if (
          !claim ||
          claim.clientId !== client.id ||
          claim.psychologistId !== client.psychologistId ||
          claim.supersededAt !== null ||
          claim.expiresAt <= new Date()
        )
          throw new ClaimNotFound();
        if (claim.redeemedAt) {
          if (claim.redeemedByFirebaseUid !== auth.value.firebaseUid) throw new ClaimConflict();
          return { clientId: claim.clientId, redeemedAt: claim.redeemedAt };
        }
        if (client.clientFirebaseUid && client.clientFirebaseUid !== auth.value.firebaseUid)
          throw new ClaimConflict();
        const bound = await tx.client.updateMany({
          where: {
            id: claim.clientId,
            deletedAt: null,
            status: 'ACTIVE',
            OR: [{ clientFirebaseUid: null }, { clientFirebaseUid: auth.value.firebaseUid }],
          },
          data: { clientFirebaseUid: auth.value.firebaseUid },
        });
        if (bound.count !== 1) throw new ClaimConflict();
        const redeemedAt = new Date();
        const redeemed = await tx.clientClaimToken.updateMany({
          where: { id: claim.id, redeemedAt: null, supersededAt: null },
          data: { redeemedAt, redeemedByFirebaseUid: auth.value.firebaseUid },
        });
        if (redeemed.count !== 1) throw new ClaimConflict();
        await writeAudit(
          {
            actorType: 'CLIENT',
            action: 'CLIENT_CLAIM_TOKEN_REDEEMED',
            targetType: 'ClientClaimToken',
            targetId: claim.id,
            metadata: { ...auditMetadataFromRequest(req), clientId: claim.clientId },
          },
          tx,
        );
        return { clientId: claim.clientId, redeemedAt };
      },
      { isolationLevel: 'Serializable' },
    );
    return privateJson({
      clientId: result.clientId,
      redeemedAt: result.redeemedAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof ClaimConflict)
      return privateJson({ error: 'Claim is no longer available' }, { status: 409 });
    if (error instanceof ClaimNotFound)
      return privateJson({ error: 'Claim not found' }, { status: 404 });
    throw error;
  }
}
class ClaimNotFound extends Error {}
class ClaimConflict extends Error {}

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...Object.fromEntries(new Headers(init?.headers).entries()),
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function privateResponse(response: Response): NextResponse {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
