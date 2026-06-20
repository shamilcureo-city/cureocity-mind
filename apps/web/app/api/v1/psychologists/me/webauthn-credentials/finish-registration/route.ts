import { NextResponse, type NextRequest } from 'next/server';
import { FinishRegistrationInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toWebAuthnCredential } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { verifyClientDataForRegistration, verifyRegistrationTicket } from '@/lib/webauthn-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/psychologists/me/webauthn-credentials/finish-registration
 *
 * Verifies the ticket from /begin, matches the client-data challenge,
 * and persists the new credential. Audits as WEBAUTHN_CREDENTIAL_REGISTERED.
 *
 * V1.1 verification (this PR):
 *   - HMAC ticket valid + not expired + bound to this user
 *   - clientDataJSON.type === "webauthn.create"
 *   - clientDataJSON.challenge === ticket.challenge
 *
 * V1.2 (Sprint 18 PR 2) will add COSE-key parse + RP-ID hash check
 * inside attestationObject. Until then the publicKey is stored verbatim
 * for forensic replay.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, FinishRegistrationInputSchema);
  if (!body.ok) return body.response;

  const ticket = verifyRegistrationTicket(body.value.ticket, auth.value.psychologistId);
  if (!ticket.ok) {
    return NextResponse.json(
      { error: `Registration ticket invalid: ${ticket.reason}` },
      { status: 400 },
    );
  }

  const cdj = verifyClientDataForRegistration(body.value.clientDataJSON, ticket.challenge);
  if (!cdj.ok) {
    return NextResponse.json(
      { error: `clientDataJSON verification failed: ${cdj.reason}` },
      { status: 400 },
    );
  }

  // Globally unique credentialId — reject duplicates with a clear error.
  const existing = await prisma.webAuthnCredential.findUnique({
    where: { credentialId: body.value.credentialId },
    select: { id: true, psychologistId: true },
  });
  if (existing) {
    if (existing.psychologistId !== auth.value.psychologistId) {
      return NextResponse.json(
        { error: 'Credential already registered to another account' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Credential already registered' }, { status: 409 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.webAuthnCredential.create({
      data: {
        psychologistId: auth.value.psychologistId,
        credentialId: body.value.credentialId,
        publicKey: body.value.publicKey,
        signCount: 0,
        transports: body.value.transports,
        label: body.value.label ?? null,
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'WEBAUTHN_CREDENTIAL_REGISTERED',
        targetType: 'WebAuthnCredential',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          label: row.label,
          transports: row.transports,
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json({ credential: toWebAuthnCredential(created) }, { status: 201 });
}
