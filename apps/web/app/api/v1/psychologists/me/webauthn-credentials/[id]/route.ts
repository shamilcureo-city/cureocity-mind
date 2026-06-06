import { NextResponse, type NextRequest } from 'next/server';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toWebAuthnCredential } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/v1/psychologists/me/webauthn-credentials/[id]
 *
 * Revokes a credential by setting revokedAt. The row is kept for
 * audit. Audits as WEBAUTHN_CREDENTIAL_REVOKED.
 *
 * Refuses if it's the LAST non-revoked credential AND there's been at
 * least one sign event with that credential — losing the only working
 * authenticator locks the therapist out of signing. The caller can
 * pass ?force=true once a backup recovery flow exists.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const row = await prisma.webAuthnCredential.findUnique({ where: { id } });
  if (!row || row.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
  }
  if (row.revokedAt !== null) {
    return NextResponse.json({ error: 'Credential already revoked' }, { status: 409 });
  }

  // Safety check: don't allow removing the last credential without
  // ?force=true once a real recovery flow lands.
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';
  const otherActiveCount = await prisma.webAuthnCredential.count({
    where: {
      psychologistId: auth.value.psychologistId,
      revokedAt: null,
      id: { not: id },
    },
  });
  if (otherActiveCount === 0 && !force) {
    return NextResponse.json(
      {
        error:
          'Cannot remove the last active credential. Register a backup first, or pass ?force=true (loses passwordless signing).',
      },
      { status: 409 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const revoked = await tx.webAuthnCredential.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'WEBAUTHN_CREDENTIAL_REVOKED',
        targetType: 'WebAuthnCredential',
        targetId: id,
        metadata: {
          ...auditMetadataFromRequest(req),
          label: row.label,
          force,
        },
      },
      tx,
    );
    return revoked;
  });

  return NextResponse.json({ credential: toWebAuthnCredential(updated) });
}
