import { NextResponse, type NextRequest } from 'next/server';
import { UpdateClientInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toClient } from '@/lib/mappers';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function fetchOwnedClient(psychologistId: string, clientId: string) {
  const row = await prisma.client.findUnique({ where: { id: clientId } });
  if (!row || row.deletedAt !== null) return null;
  if (row.psychologistId !== psychologistId) return null;
  return row;
}

/**
 * GET /api/v1/clients/:id — single read + CLIENT_VIEWED audit row.
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const row = await fetchOwnedClient(auth.value.psychologistId, id);
  if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'CLIENT_VIEWED',
    targetType: 'Client',
    targetId: id,
    metadata: auditMetadataFromRequest(req),
  });
  return NextResponse.json(await toClient(row));
}

/**
 * PATCH /api/v1/clients/:id — partial update. Writes a CLIENT_UPDATED
 * audit row with both before + after captured in metadata.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const existing = await fetchOwnedClient(auth.value.psychologistId, id);
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  const dto = await parseJson(req, UpdateClientInputSchema);
  if (!dto.ok) return dto.response;

  // S32 Phase 1 — re-encrypt PII whenever the plaintext changes. Hoisted
  // outside the tx for the same reason as POST /clients (KMS round-trip
  // shouldn't stretch the row lock).
  // Sprint 54 — re-encrypt fullName whenever the plaintext changes.
  const fullNameEncrypted =
    dto.value.fullName !== undefined
      ? await encryptForTenant(auth.value.psychologistId, dto.value.fullName)
      : undefined;
  const contactPhoneEncrypted =
    dto.value.contactPhone !== undefined
      ? await encryptForTenant(auth.value.psychologistId, dto.value.contactPhone)
      : undefined;
  const contactEmailEncrypted =
    dto.value.contactEmail !== undefined
      ? dto.value.contactEmail
        ? await encryptForTenant(auth.value.psychologistId, dto.value.contactEmail)
        : null
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.client.update({
      where: { id },
      data: {
        // S32 Phase 2 — PII is written ONLY to the encrypted columns; the
        // plaintext columns were dropped.
        ...(fullNameEncrypted !== undefined && { fullNameEncrypted }),
        ...(contactPhoneEncrypted !== undefined && { contactPhoneEncrypted }),
        ...(contactEmailEncrypted !== undefined && { contactEmailEncrypted }),
        ...(dto.value.dateOfBirth !== undefined && {
          dateOfBirth: dto.value.dateOfBirth ? new Date(dto.value.dateOfBirth) : null,
        }),
        ...(dto.value.presentingConcerns !== undefined && {
          presentingConcerns: dto.value.presentingConcerns,
        }),
        ...(dto.value.preferredModality !== undefined && {
          preferredModality: dto.value.preferredModality,
        }),
        ...(dto.value.preferredLanguage !== undefined && {
          preferredLanguage: dto.value.preferredLanguage,
        }),
        ...(dto.value.spokenLanguages !== undefined && {
          spokenLanguages: dto.value.spokenLanguages,
        }),
        ...(dto.value.status !== undefined && { status: dto.value.status }),
      },
    });
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(dto.value) as (keyof typeof dto.value)[]) {
      before[key] = (existing as unknown as Record<string, unknown>)[key];
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_UPDATED',
        targetType: 'Client',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), before, after: dto.value },
      },
      tx,
    );
    return row;
  });
  return NextResponse.json(await toClient(updated));
}

/**
 * DELETE /api/v1/clients/:id — archive (soft-delete). Sets `deletedAt`
 * so the client drops out of every roster/list (all queries filter
 * `deletedAt: null`) while the underlying record — encounters, notes,
 * audit trail — is retained for statutory / audit obligations. This is
 * deliberately NOT a hard delete and NOT the DPDP erasure path (that is
 * the deliberately-gated `dsr/erasure` → admin-fulfilment flow, which
 * additionally scrubs PHI). The audit row carries `cause:
 * 'THERAPIST_ARCHIVE'` so it is distinguishable from a regulatory
 * `CLIENT_SOFT_DELETED` fired by DSR erasure.
 *
 * Side-effecting, so it is a DELETE (never GET — prefetchers only fire
 * GET; see docs/AUTH_SESSION.md). Idempotent in effect: a second call on
 * an already-archived client 404s via `fetchOwnedClient`.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const existing = await fetchOwnedClient(auth.value.psychologistId, id);
  if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.client.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_SOFT_DELETED',
        targetType: 'Client',
        targetId: id,
        metadata: { ...auditMetadataFromRequest(req), cause: 'THERAPIST_ARCHIVE' },
      },
      tx,
    );
  });

  return NextResponse.json({ ok: true });
}
