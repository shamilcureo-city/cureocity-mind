import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { canonicalJson } from './sign-note-payload';
import { boundedDocumentBody } from './scribe-document-errors';
import { ScribeWorkspaceError } from './scribe-workspace-auth';
import { createScribeRecord, getScribeRecord, listScribeRecords } from './scribe-workspace-store';
import {
  SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS,
  ScribeDoctorTemplateBodySchema,
  ScribeDoctorTemplateRecordSchema,
  ScribeDoctorTemplatesResponseSchema,
  type ScribeDoctorTemplateCreate,
  type ScribeDoctorTemplateRecord,
} from './scribe-doctor-templates';

const hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
export const scribeDoctorTemplateScope = (owner: string) => ({
  psychologistId: owner,
  kind: 'template' as const,
});

/** Serialize personal library reads with edits and practitioner suspension/erasure. */
export async function lockScribeTemplateOwner(
  tx: Prisma.TransactionClient,
  owner: string,
): Promise<void> {
  const active = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "psychologists" WHERE "id" = ${owner}
    AND "deletedAt" IS NULL AND "vertical" = 'DOCTOR' AND "status" = 'ACTIVE' FOR UPDATE
  `;
  if (!active[0]) throw new ScribeWorkspaceError(403, 'The doctor workspace is no longer active.');
}

export async function readScribeTemplateJson(req: Request): Promise<unknown> {
  const bytes = await boundedDocumentBody(req, 64 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ScribeWorkspaceError(400, 'Invalid template request.');
  }
}

export async function readScribeDoctorTemplates(owner: string) {
  return prisma.$transaction(async (tx) => {
    await lockScribeTemplateOwner(tx, owner);
    const records = await listScribeRecords(
      { ...scribeDoctorTemplateScope(owner), limit: SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS + 1 },
      ScribeDoctorTemplateBodySchema,
      tx,
    );
    if (records.length > SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS)
      throw new ScribeWorkspaceError(
        503,
        'The template library could not be loaded completely. Please contact support.',
      );
    return ScribeDoctorTemplatesResponseSchema.parse({ records });
  });
}

export async function readScribeDoctorTemplate(
  owner: string,
  id: string,
): Promise<ScribeDoctorTemplateRecord> {
  return prisma.$transaction(async (tx) => {
    await lockScribeTemplateOwner(tx, owner);
    const record = await getScribeRecord(
      scribeDoctorTemplateScope(owner),
      id,
      ScribeDoctorTemplateBodySchema,
      tx,
    );
    if (!record) throw new ScribeWorkspaceError(404, 'Template not found.');
    return ScribeDoctorTemplateRecordSchema.parse(record);
  });
}

class TemplateReplay extends Error {
  constructor(readonly record: ScribeDoctorTemplateRecord) {
    super('Template create replay.');
  }
}

export async function createScribeDoctorTemplate(owner: string, input: ScribeDoctorTemplateCreate) {
  const scope = scribeDoctorTemplateScope(owner);
  const id = `scribe-template-${hash([owner, input.operationId])}`;
  const createHash = hash(input.template);
  const body = ScribeDoctorTemplateBodySchema.parse({
    version: 1,
    operationId: input.operationId,
    createHash,
    template: input.template,
  });
  try {
    const record = await createScribeRecord(
      {
        ...scope,
        guard: async (tx) => {
          // The store holds the owner lock: two tabs cannot both pass this quota/replay check.
          const existing = await getScribeRecord(scope, id, ScribeDoctorTemplateBodySchema, tx);
          if (existing) {
            if (
              existing.body.operationId !== input.operationId ||
              existing.body.createHash !== createHash
            )
              throw new ScribeWorkspaceError(
                409,
                'This save attempt already belongs to a different template. Reload before retrying.',
              );
            throw new TemplateReplay(ScribeDoctorTemplateRecordSchema.parse(existing));
          }
          // Deletion consumes the original operation. Otherwise a delayed create
          // retry could resurrect the same id at revision 1 (a stale-CAS/ABA hazard).
          // The store writes this content-free audit atomically with the delete,
          // under this same owner lock; do not retain the deleted template body.
          const deletedOperation = await tx.auditLog.findFirst({
            where: {
              actorPsychologistId: owner,
              actorType: 'PSYCHOLOGIST',
              action: 'SCRIBE_WORKSPACE_UPDATED',
              targetType: 'ScribeWorkspaceRecord',
              targetId: id,
              AND: [
                { metadata: { path: ['kind'], equals: 'template' } },
                { metadata: { path: ['operation'], equals: 'delete' } },
              ],
            },
            select: { id: true },
          });
          if (deletedOperation)
            throw new ScribeWorkspaceError(
              409,
              'This template was deleted. Reload, then start a new save to create another template.',
            );
          const count = await tx.scribeWorkspaceRecord.count({
            where: { ...scope, clientId: null, sessionId: null },
          });
          if (count >= SCRIBE_DOCTOR_TEMPLATE_MAX_RECORDS)
            throw new ScribeWorkspaceError(
              409,
              'Your library has 50 templates. Remove an unused template before adding another.',
            );
        },
      },
      body,
      id,
    );
    return { record: ScribeDoctorTemplateRecordSchema.parse(record), created: true };
  } catch (error) {
    if (error instanceof TemplateReplay) return { record: error.record, created: false };
    throw error;
  }
}
