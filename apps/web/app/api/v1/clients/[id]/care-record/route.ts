import { type NextRequest } from 'next/server';
import { MindCareRecordQuerySchema, SaveMindCareRecordInputSchema } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { privateJson, privateResponse } from '@/lib/private-response';
import { ClientPhiWriteForbiddenError, lockActiveClient } from '@/lib/phi-write-lock';
import { MindCareRecordUnreadableError, toMindCareRecordDto } from '@/lib/mind-care-record';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { prisma } from '@/lib/prisma';
import { parseJson, parseQuery } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const notFound = () => privateJson({ error: 'Client not found' }, { status: 404 });
const unreadable = () =>
  privateJson(
    {
      error:
        'The saved care record could not be read. It has not been replaced. Contact support before changing it.',
    },
    { status: 503 },
  );

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');
  if (!auth.ok) return privateResponse(auth.response);
  const documentation = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!documentation.ok) return privateResponse(documentation.response);
  if (auth.value.user.vertical !== 'THERAPIST') return notFound();
  const query = parseQuery(req.url, MindCareRecordQuerySchema);
  if (!query.ok) return privateResponse(query.response);
  const { id: clientId } = await params;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockActiveClient(tx, clientId, auth.value.psychologistId);
        const where = { clientId, psychologistId: auth.value.psychologistId };
        const latest = await tx.clientMindCareRecord.findFirst({
          where,
          orderBy: { version: 'desc' },
        });
        const row =
          query.value.version === undefined
            ? latest
            : await tx.clientMindCareRecord.findFirst({
                where: { ...where, version: query.value.version },
              });
        if (!row && query.value.version !== undefined)
          return privateJson({ error: 'Care record version not found' }, { status: 404 });
        const record = row ? await toMindCareRecordDto(row) : null;
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'CLIENT_BRIEFING_VIEWED',
            targetType: 'Client',
            targetId: clientId,
            metadata: {
              ...auditMetadataFromRequest(req),
              surface: 'mind-care-record',
              version: row?.version ?? 0,
              outcome: 'viewed',
            },
          },
          tx,
        );
        return privateJson({ record, latestVersion: latest?.version ?? 0 });
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return notFound();
    if (error instanceof MindCareRecordUnreadableError) return unreadable();
    throw error;
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'THERAPY_WORKFLOWS');
  if (!auth.ok) return privateResponse(auth.response);
  const documentation = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!documentation.ok) return privateResponse(documentation.response);
  if (auth.value.user.vertical !== 'THERAPIST') return notFound();
  const parsed = await parseJson(req, SaveMindCareRecordInputSchema);
  if (!parsed.ok) return privateResponse(parsed.response);
  const input = SaveMindCareRecordInputSchema.parse(parsed.value);
  const { id: clientId } = await params;
  const client = await prisma.client.findFirst({
    where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
    select: { id: true },
  });
  if (!client) return notFound();
  // KMS work is outside the write transaction; the active-client lock is rechecked afterwards.
  const serialized = JSON.stringify(input.body);
  const bodyEncrypted = await encryptForTenant(auth.value.psychologistId, serialized);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockActiveClient(tx, clientId, auth.value.psychologistId);
        const locked = await tx.client.findFirst({
          where: { id: clientId, psychologistId: auth.value.psychologistId, deletedAt: null },
          select: { status: true },
        });
        if (!locked) throw new ClientPhiWriteForbiddenError();
        const where = { clientId, psychologistId: auth.value.psychologistId };
        const latest = await tx.clientMindCareRecord.findFirst({
          where,
          orderBy: { version: 'desc' },
        });
        const receipt = await tx.clientMindCareRecord.findFirst({
          where: { ...where, operationId: input.operationId },
        });
        if (receipt) {
          const record = await toMindCareRecordDto(receipt);
          if (
            JSON.stringify(record.body) !== serialized ||
            record.version !== input.expectedVersion + 1
          )
            return privateJson(
              { error: 'This save identifier was already used for a different care record.' },
              { status: 409 },
            );
          return privateJson({ record, latestVersion: latest?.version ?? record.version });
        }
        // Authored follow-through remains possible after ending/transfer. This is a
        // documentation-only amendment: never reopen or change the client/episode status.
        if ((latest?.version ?? 0) !== input.expectedVersion)
          return privateJson(
            {
              error:
                'A newer care record exists. Keep your draft and review the latest version before saving.',
            },
            { status: 409 },
          );
        if (latest) await toMindCareRecordDto(latest); // unreadable history is never silently replaced
        const row = await tx.clientMindCareRecord.create({
          data: {
            clientId,
            psychologistId: auth.value.psychologistId,
            version: input.expectedVersion + 1,
            operationId: input.operationId,
            bodyEncrypted,
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'MIND_CARE_RECORD_SAVED',
            targetType: 'ClientMindCareRecord',
            targetId: row.id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId,
              version: row.version,
              operationId: input.operationId,
            },
          },
          tx,
        );
        return privateJson(
          {
            record: {
              id: row.id,
              clientId,
              version: row.version,
              operationId: row.operationId,
              createdAt: row.createdAt.toISOString(),
              body: input.body,
            },
            latestVersion: row.version,
          },
          { status: 201 },
        );
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    if (error instanceof ClientPhiWriteForbiddenError) return notFound();
    if (error instanceof MindCareRecordUnreadableError) return unreadable();
    throw error;
  }
}
