import { NextResponse, type NextRequest } from 'next/server';
import type { NoteEditRecovery, Prisma } from '@prisma/client';
import {
  DeleteNoteEditRecoveryInputSchema,
  NoteEditRecoveryFieldsSchema,
  PutNoteEditRecoveryInputSchema,
} from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { encryptForTenant, decryptForTenant } from '@/lib/tenant-crypto';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
interface Context {
  params: Promise<{ id: string }>;
}
class RecoveryConflict extends Error {}

function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
function json(body: unknown, status = 200): NextResponse {
  return noStore(NextResponse.json(body, { status }));
}
function failure(error: unknown): NextResponse {
  if (error instanceof ClientPhiWriteForbiddenError)
    return json({ error: 'Session not found' }, 404);
  if (error instanceof RecoveryConflict) return json({ error: error.message }, 409);
  // Never include submitted/decrypted fields, ciphertext or provider errors.
  return json({ error: 'Note recovery is unavailable. Keep this editor open and retry.' }, 503);
}

/** All readers/writers share the same erasure, canonical-save and signing lock. */
async function lockedSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
  psychologistId: string,
) {
  const client = await lockActiveClientForSession(tx, sessionId, psychologistId);
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    select: {
      clientId: true,
      psychologistId: true,
      kind: true,
      status: true,
      psychologist: { select: { vertical: true } },
      noteDraft: { select: { status: true, updatedAt: true, content: true } },
      therapyNote: { select: { locked: true } },
    },
  });
  if (!session || session.clientId !== client.id || session.psychologistId !== psychologistId)
    throw new ClientPhiWriteForbiddenError();
  if (session.psychologist.vertical !== 'THERAPIST')
    throw new RecoveryConflict('Manual note recovery is available only in Mind.');
  return session;
}
type RecoverySession = Awaited<ReturnType<typeof lockedSession>>;
const kindFor = (session: RecoverySession) => (session.kind === 'INTAKE' ? 'INTAKE' : 'TREATMENT');
const editable = (session: RecoverySession) =>
  session.status === 'COMPLETED' &&
  session.noteDraft?.status === 'COMPLETED' &&
  session.noteDraft.content !== null &&
  !session.therapyNote?.locked;

async function decode(row: NoteEditRecovery, psychologistId: string) {
  if (!row.encryptedFields || !row.baseDraftUpdatedAt) throw new Error('Invalid checkpoint');
  const plaintext = await decryptForTenant(psychologistId, row.encryptedFields);
  if (plaintext === null) throw new Error('Checkpoint decryption failed');
  return NoteEditRecoveryFieldsSchema.parse({ kind: row.kind, fields: JSON.parse(plaintext) });
}
const sameFields = (left: Record<string, string>, right: Record<string, string>) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.keys(left).every((key) => left[key] === right[key]);

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return noStore(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') return json({ error: 'Mind recovery only' }, 403);
  const { id: sessionId } = await params;
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const session = await lockedSession(tx, sessionId, auth.value.psychologistId);
        const row = await tx.noteEditRecovery.findUnique({ where: { sessionId } });
        const checkpoint =
          row?.encryptedFields != null ? await decode(row, auth.value.psychologistId) : null;
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'NOTE_DRAFT_VIEWED',
            targetType: 'NoteEditRecovery',
            targetId: sessionId,
            metadata: { ...auditMetadataFromRequest(req), sessionId, op: 'recovery-read' },
          },
          tx,
        );
        return {
          revision: row?.revision ?? 0,
          recovery:
            checkpoint && row
              ? {
                  fields: checkpoint.fields,
                  kind: checkpoint.kind,
                  baseUpdatedAt: row.baseDraftUpdatedAt!.toISOString(),
                  updatedAt: row.updatedAt.toISOString(),
                }
              : null,
          stale:
            checkpoint !== null &&
            (!editable(session) ||
              checkpoint.kind !== kindFor(session) ||
              row!.baseDraftUpdatedAt!.getTime() !== session.noteDraft?.updatedAt.getTime()),
        };
      },
      { timeout: 15_000 },
    );
    return json(result);
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return noStore(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') return json({ error: 'Mind recovery only' }, 403);
  const input = await parseJson(req, PutNoteEditRecoveryInputSchema);
  if (!input.ok) return noStore(input.response);
  const { id: sessionId } = await params;
  const body = input.value;
  try {
    const saved = await prisma.$transaction(
      async (tx) => {
        const session = await lockedSession(tx, sessionId, auth.value.psychologistId);
        if (
          !editable(session) ||
          kindFor(session) !== body.kind ||
          session.noteDraft!.updatedAt.toISOString() !== body.baseUpdatedAt
        )
          throw new RecoveryConflict(
            'The canonical note changed or is locked. Reopen the editor to review saved edits.',
          );
        const row = await tx.noteEditRecovery.findUnique({ where: { sessionId } });
        if (row?.lastMutationId === body.mutationId) {
          if (
            row.lastMutationOperation !== 'PUT' ||
            row.lastMutationRevision !== body.revision ||
            row.kind !== body.kind ||
            row.baseDraftUpdatedAt?.toISOString() !== body.baseUpdatedAt ||
            !row.encryptedFields
          )
            throw new RecoveryConflict('This recovery mutation identifier has already been used.');
          const prior = await decode(row, auth.value.psychologistId);
          if (!sameFields(prior.fields, body.fields))
            throw new RecoveryConflict('This recovery mutation identifier has already been used.');
          return row; // Lost response: acknowledge the original write, never write again.
        }
        if ((row?.revision ?? 0) !== body.revision)
          throw new RecoveryConflict(
            'Saved edits changed in another view. Reopen the editor before continuing.',
          );
        const encryptedFields = await encryptForTenant(
          auth.value.psychologistId,
          JSON.stringify(body.fields),
        );
        if (!encryptedFields) throw new Error('Checkpoint encryption failed');
        const data = {
          encryptedFields,
          revision: body.revision + 1,
          baseDraftUpdatedAt: new Date(body.baseUpdatedAt),
          kind: body.kind,
          lastMutationId: body.mutationId,
          lastMutationRevision: body.revision,
          lastMutationOperation: 'PUT',
        };
        const updated = await tx.noteEditRecovery.upsert({
          where: { sessionId },
          create: { sessionId, ...data },
          update: data,
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'NOTE_DRAFT_EDITED',
            targetType: 'NoteEditRecovery',
            targetId: sessionId,
            metadata: {
              ...auditMetadataFromRequest(req),
              sessionId,
              op: 'recovery-save',
              revision: updated.revision,
              kind: body.kind,
            },
          },
          tx,
        );
        return updated;
      },
      { timeout: 15_000 },
    );
    return json({ revision: saved.revision, updatedAt: saved.updatedAt.toISOString() });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return noStore(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') return json({ error: 'Mind recovery only' }, 403);
  const input = await parseJson(req, DeleteNoteEditRecoveryInputSchema);
  if (!input.ok) return noStore(input.response);
  const { id: sessionId } = await params;
  const body = input.value;
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockedSession(tx, sessionId, auth.value.psychologistId);
      const row = await tx.noteEditRecovery.findUnique({ where: { sessionId } });
      if (row?.lastMutationId === body.mutationId) {
        if (
          row.lastMutationOperation !== 'DELETE' ||
          row.lastMutationRevision !== body.revision ||
          row.encryptedFields !== null
        )
          throw new RecoveryConflict('This recovery mutation identifier has already been used.');
        return { revision: row.revision };
      }
      if ((row?.revision ?? 0) !== body.revision)
        throw new RecoveryConflict(
          'Saved edits changed in another view. Reload before discarding them.',
        );
      const data = {
        encryptedFields: null,
        revision: body.revision + 1,
        baseDraftUpdatedAt: null,
        kind: null,
        lastMutationId: body.mutationId,
        lastMutationRevision: body.revision,
        lastMutationOperation: 'DELETE',
      };
      const updated = await tx.noteEditRecovery.upsert({
        where: { sessionId },
        create: { sessionId, ...data },
        update: data,
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_EDITED',
          targetType: 'NoteEditRecovery',
          targetId: sessionId,
          metadata: {
            ...auditMetadataFromRequest(req),
            sessionId,
            op: 'recovery-discard',
            revision: updated.revision,
          },
        },
        tx,
      );
      return { revision: updated.revision };
    });
    return json(result);
  } catch (error) {
    return failure(error);
  }
}
