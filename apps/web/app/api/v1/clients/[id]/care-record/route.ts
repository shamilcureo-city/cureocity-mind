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
  // Encrypt the normal payload before taking the lifecycle lock. Only an older writer that
  // omits an existing additive section needs a second encryption of its merged body inside it.
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
          const comparedBody = { ...record.body };
          // A legacy writer did not know this additive section. Its receipt includes inherited
          // work, but the original operation is still identified by the submitted fields/version.
          if (input.body.sessionWork === undefined) delete comparedBody.sessionWork;
          if (
            JSON.stringify(comparedBody) !== serialized ||
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
        const previous = latest ? await toMindCareRecordDto(latest) : null;
        // Unreadable history is never silently replaced, and older UI writers cannot clear a
        // newer section simply because their payload schema did not yet include it.
        const savedBody =
          input.body.sessionWork === undefined && previous?.body.sessionWork
            ? { ...input.body, sessionWork: previous.body.sessionWork }
            : input.body;
        const workChanged =
          JSON.stringify(savedBody.sessionWork) !== JSON.stringify(previous?.body.sessionWork);
        if (savedBody.sessionWork && workChanged) {
          await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${savedBody.sessionWork.sessionId} AND "clientId" = ${clientId} AND "psychologistId" = ${auth.value.psychologistId} FOR UPDATE`;
          const session = await tx.session.findFirst({
            where: {
              id: savedBody.sessionWork.sessionId,
              clientId,
              psychologistId: auth.value.psychologistId,
              status: { in: ['IN_PROGRESS', 'COMPLETED'] },
            },
            select: { id: true, scheduledAt: true },
          });
          if (!session || session.scheduledAt.toISOString() !== savedBody.sessionWork.scheduledAt)
            return privateJson(
              {
                error:
                  'The source visit could not be confirmed for this client. Keep your wording and reopen the visit before saving.',
              },
              { status: 409 },
            );
        }
        const savedEncrypted =
          savedBody === input.body
            ? bodyEncrypted
            : await encryptForTenant(auth.value.psychologistId, JSON.stringify(savedBody));
        const row = await tx.clientMindCareRecord.create({
          data: {
            clientId,
            psychologistId: auth.value.psychologistId,
            version: input.expectedVersion + 1,
            operationId: input.operationId,
            bodyEncrypted: savedEncrypted,
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
              body: savedBody,
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
