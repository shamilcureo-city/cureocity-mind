import { NextResponse, type NextRequest } from 'next/server';
import {
  CreateClientInputSchema,
  ListClientsQuerySchema,
  type ListClientsResponse,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toClient } from '@/lib/mappers';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { parseJson, parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients — list, cursor-paginated, filtered by status.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const q = parseQuery(req.url, ListClientsQuerySchema);
  if (!q.ok) return q.response;
  // Zod default() narrows to the value at runtime but TS sees the
  // declared type as still-optional with `exactOptionalPropertyTypes:
  // false` — coalesce defensively.
  const limit = q.value.limit ?? 50;

  const items = await prisma.client.findMany({
    where: {
      psychologistId: auth.value.psychologistId,
      deletedAt: null,
      ...(q.value.status && { status: q.value.status }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(q.value.cursor && { cursor: { id: q.value.cursor }, skip: 1 }),
  });
  const hasMore = items.length > limit;
  const trimmed = hasMore ? items.slice(0, limit) : items;
  const body: ListClientsResponse = {
    items: trimmed.map(toClient),
    nextCursor: hasMore ? (trimmed[trimmed.length - 1]?.id ?? null) : null,
  };
  return NextResponse.json(body);
}

/**
 * POST /api/v1/clients — create + record initial consents in one tx.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CreateClientInputSchema);
  if (!body.ok) return body.response;

  const auditMeta = auditMetadataFromRequest(req);
  const now = new Date();

  // S32 Phase 1 — dual-write the encrypted PII columns. encryptForTenant
  // is hoisted outside the transaction because it may auto-provision a
  // PsychologistTenantKey row + KMS-wrap a fresh DEK; doing that inside
  // the client-create tx would extend the lock window unnecessarily.
  const contactPhoneEncrypted = await encryptForTenant(
    auth.value.psychologistId,
    body.value.contactPhone,
  );
  const contactEmailEncrypted = body.value.contactEmail
    ? await encryptForTenant(auth.value.psychologistId, body.value.contactEmail)
    : null;

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.client.create({
      data: {
        psychologistId: auth.value.psychologistId,
        fullName: body.value.fullName,
        contactPhone: body.value.contactPhone,
        contactPhoneEncrypted,
        contactEmail: body.value.contactEmail ?? null,
        contactEmailEncrypted,
        dateOfBirth: body.value.dateOfBirth ? new Date(body.value.dateOfBirth) : null,
        presentingConcerns: body.value.presentingConcerns ?? null,
        preferredModality: body.value.preferredModality ?? null,
        ...(body.value.preferredLanguage !== undefined && {
          preferredLanguage: body.value.preferredLanguage,
        }),
        ...(body.value.spokenLanguages !== undefined && {
          spokenLanguages: body.value.spokenLanguages,
        }),
        status: 'ACTIVE',
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'CLIENT_CREATED',
        targetType: 'Client',
        targetId: row.id,
        metadata: auditMeta,
      },
      tx,
    );

    for (const c of body.value.consents) {
      const consentRow = await tx.consent.create({
        data: {
          clientId: row.id,
          psychologistId: auth.value.psychologistId,
          scope: c.scope,
          status: 'GRANTED',
          scriptVersion: c.scriptVersion,
          capturedVia: c.capturedVia,
          grantedAt: now,
          notes: c.notes ?? null,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'CONSENT_GRANTED',
          targetType: 'Consent',
          targetId: consentRow.id,
          metadata: { ...auditMeta, scope: c.scope, clientId: row.id },
        },
        tx,
      );
    }
    return row;
  });
  return NextResponse.json(toClient(created), { status: 201 });
}
