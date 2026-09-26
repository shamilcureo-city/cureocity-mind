import { randomUUID } from 'node:crypto';
import type { Prisma, ScribeWorkspaceRecord } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from './prisma';
import { encryptForTenant, decryptForTenant } from './tenant-crypto';
import { lockActiveClient } from './phi-write-lock';
import { writeAudit } from './audit';
import {
  ScribeWorkspaceError,
  ScribeWorkspaceRevisionConflictError,
} from './scribe-workspace-auth';

export type ScribeRecordKind =
  | 'shortcut'
  | 'note_style'
  | 'template'
  | 'intake'
  | 'task'
  | 'report'
  | 'instructions'
  | 'coding'
  | 'documents'
  | 'teleconsult';
export interface ScribeRecordScope {
  psychologistId: string;
  kind: ScribeRecordKind;
  clientId?: string;
  sessionId?: string;
  requireUnsigned?: boolean;
  /** Public intake submissions have no authenticated practitioner author. */
  actorType?: 'PSYCHOLOGIST' | 'SYSTEM';
  limit?: number;
  /** Opt-in stable keyset pagination; existing callers retain updated-at ordering. */
  page?: { after?: { createdAt: string; id: string } };
  /** Server-owned freshness/consent guard, after lifecycle locks and before persistence. */
  guard?: (tx: Prisma.TransactionClient) => Promise<void>;
}
export interface ScribeRecord<T> {
  id: string;
  revision: number;
  body: T;
  clientId: string | null;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export type ScribeWorkspaceRecordDto<T> = ScribeRecord<T>;

const personalKinds = new Set<ScribeRecordKind>(['shortcut', 'note_style', 'template']);
const kinds = new Set<ScribeRecordKind>([
  'shortcut',
  'note_style',
  'template',
  'intake',
  'task',
  'report',
  'instructions',
  'coding',
  'documents',
  'teleconsult',
]);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const validId = (id: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(id);

function validateScope(scope: ScribeRecordScope): void {
  if (
    !validId(scope.psychologistId) ||
    !kinds.has(scope.kind) ||
    (scope.clientId !== undefined && !validId(scope.clientId)) ||
    (scope.sessionId !== undefined && !validId(scope.sessionId))
  ) {
    throw new ScribeWorkspaceError(400, 'Invalid workspace scope.');
  }
  if (personalKinds.has(scope.kind) && (scope.clientId || scope.sessionId)) {
    throw new ScribeWorkspaceError(400, 'Reusable preferences cannot be linked to a patient.');
  }
}

function where(scope: ScribeRecordScope): Prisma.ScribeWorkspaceRecordWhereInput {
  validateScope(scope);
  return {
    psychologistId: scope.psychologistId,
    kind: scope.kind,
    ...(personalKinds.has(scope.kind) ? { clientId: null, sessionId: null } : {}),
    ...(scope.clientId !== undefined ? { clientId: scope.clientId } : {}),
    ...(scope.sessionId !== undefined ? { sessionId: scope.sessionId } : {}),
    OR: [{ clientId: null }, { client: { deletedAt: null, psychologistId: scope.psychologistId } }],
  };
}

function dto<T>(row: ScribeWorkspaceRecord, body: T): ScribeRecord<T> {
  return {
    id: row.id,
    revision: row.revision,
    body,
    clientId: row.clientId,
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function decode<T>(
  row: ScribeWorkspaceRecord,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<ScribeRecord<T>> {
  const plaintext = await decryptForTenant(row.psychologistId, row.bodyEncrypted);
  try {
    const parsed = schema.safeParse(plaintext === null ? null : JSON.parse(plaintext));
    if (!parsed.success) throw new Error('unreadable');
    return dto(row, parsed.data);
  } catch {
    // Fail visibly; unreadable historical values must never appear as an empty/normal record.
    throw new ScribeWorkspaceError(
      503,
      'A saved record could not be read. Please retry before editing.',
    );
  }
}

export async function listScribeRecords<T>(
  scope: ScribeRecordScope,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  db: Pick<Prisma.TransactionClient, 'scribeWorkspaceRecord'> = prisma,
): Promise<ScribeRecord<T>[]> {
  const scopedWhere = where(scope);
  const after = scope.page?.after;
  if (after && (!validId(after.id) || !Number.isFinite(Date.parse(after.createdAt)))) {
    throw new ScribeWorkspaceError(400, 'Invalid page cursor. Reload the report list.');
  }
  const rows = await db.scribeWorkspaceRecord.findMany({
    where: after
      ? {
          ...scopedWhere,
          // Keep the existing tenant/client/lifecycle OR intact: pagination is an AND.
          AND: [
            {
              OR: [
                { createdAt: { lt: new Date(after.createdAt) } },
                { createdAt: new Date(after.createdAt), id: { gt: after.id } },
              ],
            },
          ],
        }
      : scopedWhere,
    orderBy: scope.page
      ? [{ createdAt: 'desc' }, { id: 'asc' }]
      : [{ updatedAt: 'desc' }, { id: 'asc' }],
    // At most ten displayed records plus a single lookahead in opt-in mode.
    take: Math.max(1, Math.min(scope.limit ?? (scope.page ? 6 : 200), scope.page ? 11 : 500)),
  });
  return Promise.all(rows.map((row) => decode(row, schema)));
}

export async function getScribeRecord<T>(
  scope: ScribeRecordScope,
  id: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  db: Pick<Prisma.TransactionClient, 'scribeWorkspaceRecord'> = prisma,
): Promise<ScribeRecord<T> | null> {
  if (!validId(id)) return null;
  const row = await db.scribeWorkspaceRecord.findFirst({ where: { ...where(scope), id } });
  return row ? decode(row, schema) : null;
}

async function encode(scope: ScribeRecordScope, body: unknown): Promise<string> {
  validateScope(scope);
  const text = JSON.stringify(body);
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    throw new ScribeWorkspaceError(
      413,
      'This record is too large. Use a smaller report or less text.',
    );
  }
  const encrypted = await encryptForTenant(scope.psychologistId, text);
  if (!encrypted)
    throw new ScribeWorkspaceError(503, 'Secure storage is unavailable. Nothing was saved.');
  return encrypted;
}

/** All writes share the same lifecycle lock as erasure, then recheck session linkage. */
async function lockScope(tx: Prisma.TransactionClient, scope: ScribeRecordScope): Promise<void> {
  if (scope.clientId) await lockActiveClient(tx, scope.clientId, scope.psychologistId);
  else if (!personalKinds.has(scope.kind)) {
    throw new ScribeWorkspaceError(400, 'A patient is required for this record.');
  } else {
    // Serializes preference creation/deletion and bounds per-doctor storage growth.
    const owners = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "psychologists" WHERE "id" = ${scope.psychologistId}
      AND "deletedAt" IS NULL AND "vertical" = 'DOCTOR' FOR UPDATE
    `;
    if (!owners[0]) throw new ScribeWorkspaceError(404, 'Doctor not found.');
  }
  // Token-authorised intake writes do not pass through practitioner login. They
  // must still stop if the granting doctor was suspended, erased or moved vertical.
  const activeOwners = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "psychologists" WHERE "id" = ${scope.psychologistId}
    AND "deletedAt" IS NULL AND "vertical" = 'DOCTOR' AND "status" = 'ACTIVE' FOR SHARE
  `;
  if (!activeOwners[0])
    throw new ScribeWorkspaceError(403, 'The doctor workspace is no longer active.');
  if (scope.sessionId) {
    // Lock Session too: signing must never race a draft-only mutation.
    await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${scope.sessionId} FOR UPDATE`;
    const session = await tx.session.findUnique({
      where: { id: scope.sessionId },
      select: { clientId: true, psychologistId: true, therapyNote: { select: { signedAt: true } } },
    });
    if (
      !session ||
      session.clientId !== scope.clientId ||
      session.psychologistId !== scope.psychologistId
    ) {
      throw new ScribeWorkspaceError(404, 'Encounter not found.');
    }
    if (scope.requireUnsigned && session.therapyNote?.signedAt) {
      throw new ScribeWorkspaceError(
        409,
        'This encounter is signed. Its clinical content cannot be changed here.',
      );
    }
  }
}

async function audit(
  tx: Prisma.TransactionClient,
  scope: ScribeRecordScope,
  id: string,
  operation: string,
  revision: number,
): Promise<void> {
  const actorType = scope.actorType ?? 'PSYCHOLOGIST';
  await writeAudit(
    {
      actorType,
      ...(actorType === 'PSYCHOLOGIST' ? { actorPsychologistId: scope.psychologistId } : {}),
      action: 'SCRIBE_WORKSPACE_UPDATED',
      targetType: 'ScribeWorkspaceRecord',
      targetId: id,
      metadata: {
        kind: scope.kind,
        operation,
        revision,
        ...(scope.clientId ? { clientId: scope.clientId } : {}),
        ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
      },
    },
    tx,
  );
}

export async function createScribeRecord<T>(
  scope: ScribeRecordScope,
  body: T,
  id: string = randomUUID(),
): Promise<ScribeRecord<T>> {
  if (!validId(id)) throw new ScribeWorkspaceError(400, 'Invalid record identifier.');
  const bodyEncrypted = await encode(scope, body);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockScope(tx, scope);
      await scope.guard?.(tx);
      const count = await tx.scribeWorkspaceRecord.count({
        where: {
          psychologistId: scope.psychologistId,
          kind: scope.kind,
          clientId: scope.clientId ?? null,
        },
      });
      if (count >= 500)
        throw new ScribeWorkspaceError(
          409,
          'This workspace has reached its record limit. Remove unused items before adding more.',
        );
      const row = await tx.scribeWorkspaceRecord.create({
        data: {
          id,
          psychologistId: scope.psychologistId,
          kind: scope.kind,
          clientId: scope.clientId ?? null,
          sessionId: scope.sessionId ?? null,
          bodyEncrypted,
        },
      });
      await audit(tx, scope, row.id, 'create', row.revision);
      return dto(row, body);
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
      throw new ScribeWorkspaceError(
        409,
        'This item was already saved. Reload before making another change.',
      );
    }
    throw error;
  }
}

async function mutate<T>(
  scope: ScribeRecordScope,
  id: string,
  expectedRevision: number,
  body?: T,
): Promise<ScribeRecord<T> | null> {
  if (!validId(id) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new ScribeWorkspaceError(400, 'A valid record and revision are required.');
  }
  const bodyEncrypted = body === undefined ? undefined : await encode(scope, body);
  return prisma.$transaction(async (tx) => {
    // Recover the stored patient/session scope, not a caller-supplied replacement.
    const row = await tx.scribeWorkspaceRecord.findFirst({ where: { ...where(scope), id } });
    if (!row) throw new ScribeWorkspaceError(404, 'Record not found.');
    const storedScope: ScribeRecordScope = {
      ...scope,
      ...(row.clientId ? { clientId: row.clientId } : {}),
      ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    };
    await lockScope(tx, storedScope);
    await scope.guard?.(tx);
    const condition = { ...where(storedScope), id, revision: expectedRevision };
    if (bodyEncrypted === undefined) {
      const removed = await tx.scribeWorkspaceRecord.deleteMany({ where: condition });
      if (removed.count !== 1)
        throw new ScribeWorkspaceRevisionConflictError(
          'This item changed in another window. Reload before deleting.',
        );
      await audit(tx, storedScope, id, 'delete', expectedRevision);
      return null;
    }
    const changed = await tx.scribeWorkspaceRecord.updateMany({
      where: condition,
      data: { bodyEncrypted, revision: { increment: 1 } },
    });
    if (changed.count !== 1)
      throw new ScribeWorkspaceRevisionConflictError(
        'This item changed in another window. Reload to review the latest version.',
      );
    const updated = await tx.scribeWorkspaceRecord.findUniqueOrThrow({ where: { id } });
    await audit(tx, storedScope, id, 'update', updated.revision);
    return dto(updated, body as T);
  });
}

export async function updateScribeRecord<T>(
  scope: ScribeRecordScope,
  id: string,
  expectedRevision: number,
  body: T,
): Promise<ScribeRecord<T>> {
  return (await mutate(scope, id, expectedRevision, body))!;
}

export async function deleteScribeRecord(
  scope: ScribeRecordScope,
  id: string,
  expectedRevision: number,
): Promise<void> {
  await mutate(scope, id, expectedRevision);
}
