import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  MindManualNoteFieldsSchema,
  MindManualNoteInputSchema,
  canonicalMindManualNote,
  sessionKindForMindPurpose,
} from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { ClientPhiWriteForbiddenError, lockActiveClientForSession } from '@/lib/phi-write-lock';
import { encryptForTenant, decryptForTenant } from '@/lib/tenant-crypto';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
class ManualConflict extends Error {}

async function lockedSession(tx: Prisma.TransactionClient, sessionId: string, owner: string) {
  await lockActiveClientForSession(tx, sessionId, owner);
  await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
  const session = await tx.session.findUnique({
    where: { id: sessionId },
    include: {
      noteDraft: true,
      therapyNote: true,
      mindManualNoteDraft: true,
      _count: { select: { audioChunks: true, transcriptSegments: true, geminiCallLogs: true } },
    },
  });
  if (!session || session.psychologistId !== owner) throw new ClientPhiWriteForbiddenError();
  return session;
}
type LoadedSession = Awaited<ReturnType<typeof lockedSession>>;

async function state(session: LoadedSession, owner: string) {
  const saved = session.mindManualNoteDraft;
  const content = session.noteDraft?.content;
  let fields = MindManualNoteFieldsSchema.parse({});
  if (saved?.encryptedFields) {
    const plaintext = await decryptForTenant(owner, saved.encryptedFields);
    if (plaintext === null) throw new Error('Secure note unavailable');
    fields = MindManualNoteFieldsSchema.parse(JSON.parse(plaintext));
  } else if (content && typeof content === 'object' && !Array.isArray(content)) {
    const extracted: Record<string, unknown> = {};
    for (const key of Object.keys(fields))
      if (typeof content[key] === 'string') extracted[key] = content[key];
    const risk = content.riskFlags;
    if (risk && typeof risk === 'object' && !Array.isArray(risk)) {
      extracted.riskSeverity = risk.severity;
      extracted.riskDetails = risk.details ?? '';
    }
    fields = MindManualNoteFieldsSchema.parse(extracted);
  }
  return {
    sessionId: session.id,
    kind: session.kind,
    purpose: session.mindPurpose,
    status: session.status,
    mode: session.mindDocumentationMode,
    revision: saved?.revision ?? 0,
    noteUpdatedAt: session.noteDraft?.updatedAt.toISOString() ?? null,
    fields,
    hasUnappliedDraft: saved?.encryptedFields != null,
    note: session.noteDraft?.content ?? null,
    signed: session.therapyNote?.locked === true,
    signedAt: session.therapyNote?.signedAt?.toISOString() ?? null,
  };
}

function failure(error: unknown) {
  if (error instanceof ClientPhiWriteForbiddenError)
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  if (error instanceof ManualConflict)
    return NextResponse.json({ error: error.message }, { status: 409 });
  // KMS/parse errors may contain clinical text; never log or expose raw exceptions.
  return NextResponse.json(
    { error: 'Your note could not be securely loaded or saved. Keep this view open and retry.' },
    { status: 503 },
  );
}

/** Encrypted unfinished note and canonical review state. No transcript or model requests. */
export async function GET(req: NextRequest, ctx: Context) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST')
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const capability = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!capability.ok) return capability.response;
  const { id } = await ctx.params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const session = await lockedSession(tx, id, auth.value.psychologistId);
      if (session.mindDocumentationMode !== 'MANUAL')
        throw new ManualConflict('Open a clinician-written session from Start session.');
      const result = await state(session, auth.value.psychologistId);
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_VIEWED',
          targetType: 'Session',
          targetId: id,
          metadata: { ...auditMetadataFromRequest(req), source: 'CLINICIAN_WRITTEN' },
        },
        tx,
      );
      return result;
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}

/** Start, save encrypted incomplete work, or explicitly finish into the existing signable note. */
export async function POST(req: NextRequest, ctx: Context) {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST')
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  const capability = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION', auth);
  if (!capability.ok) return capability.response;
  const input = await parseJson(req, MindManualNoteInputSchema);
  if (!input.ok) return input.response;
  const { id } = await ctx.params;
  const body = MindManualNoteInputSchema.parse(input.value);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const session = await lockedSession(tx, id, auth.value.psychologistId);
      if (body.operation === 'start') {
        if (
          session.mindDocumentationMode === 'MANUAL' &&
          ['IN_PROGRESS', 'COMPLETED'].includes(session.status)
        ) {
          if (body.mindPurpose && body.mindPurpose !== session.mindPurpose)
            throw new ManualConflict(
              'This session already started with another purpose. Reopen its saved workspace.',
            );
          return state(session, auth.value.psychologistId);
        }
        if (
          session.status !== 'SCHEDULED' ||
          session.updatedAt.toISOString() !== body.expectedUpdatedAt ||
          session.captureMode !== null ||
          session.noteDraft ||
          session._count.audioChunks ||
          session._count.transcriptSegments ||
          session._count.geminiCallLogs
        ) {
          throw new ManualConflict(
            'This visit has started or contains capture work. Reopen its existing workspace; start a separate visit for clinician-written notes.',
          );
        }
        const purpose = body.mindPurpose ?? session.mindPurpose;
        await tx.session.update({
          where: { id },
          data: {
            mindDocumentationMode: 'MANUAL',
            mindPurpose: purpose,
            ...(body.mindPurpose ? { kind: sessionKindForMindPurpose(body.mindPurpose) } : {}),
            ...(body.mindPurpose === 'ASSESSMENT' ? { modality: null } : {}),
            ...(body.mindPurpose === 'COUNSELLING' ? { modality: 'SUPPORTIVE' } : {}),
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            // Preserve any historical snapshot; this creates no consent and the
            // immutable MANUAL mode prevents it being used to activate AI/audio.
            noteTemplateId: null,
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'SESSION_STARTED',
            targetType: 'Session',
            targetId: id,
            metadata: { ...auditMetadataFromRequest(req), source: 'CLINICIAN_WRITTEN', purpose },
          },
          tx,
        );
      } else {
        if (
          session.mindDocumentationMode !== 'MANUAL' ||
          !['IN_PROGRESS', 'COMPLETED'].includes(session.status)
        )
          throw new ManualConflict('This visit is not an editable clinician-written session.');
        const saved = session.mindManualNoteDraft;
        const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
        if (saved?.lastMutationId === body.mutationId) {
          if (
            !saved.lastMutationHashEncrypted ||
            (await decryptForTenant(auth.value.psychologistId, saved.lastMutationHashEncrypted)) !==
              hash
          )
            throw new ManualConflict('This save identifier was already used for different work.');
          return state(session, auth.value.psychologistId);
        }
        if (session.therapyNote?.locked)
          throw new ManualConflict(
            'This note is signed and locked. Reopen it explicitly before editing.',
          );
        if ((saved?.revision ?? 0) !== body.expectedRevision)
          throw new ManualConflict(
            'This note changed in another view. Keep your text, then reload the saved version to compare before saving again.',
          );
        let note;
        if ((session.noteDraft?.updatedAt.toISOString() ?? null) !== body.expectedNoteUpdatedAt)
          throw new ManualConflict(
            'The clinical note changed since you opened it. Keep your text and reload the saved version to compare before continuing.',
          );
        if (body.operation === 'complete') {
          try {
            note = canonicalMindManualNote(session.kind, session.modality, body.fields);
          } catch {
            throw new ManualConflict(
              'Complete the required clinical fields and safety assessment. Document uncertainty or information not yet assessed in your own words.',
            );
          }
        }
        const encryptedFields =
          body.operation === 'save'
            ? await encryptForTenant(auth.value.psychologistId, JSON.stringify(body.fields))
            : null;
        if (body.operation === 'save' && !encryptedFields)
          throw new Error('Encryption unavailable');
        const lastMutationHashEncrypted = await encryptForTenant(auth.value.psychologistId, hash);
        if (!lastMutationHashEncrypted) throw new Error('Receipt encryption unavailable');
        await tx.mindManualNoteDraft.upsert({
          where: { sessionId: id },
          create: {
            sessionId: id,
            encryptedFields,
            revision: body.expectedRevision + 1,
            lastMutationId: body.mutationId,
            lastMutationHashEncrypted,
          },
          update: {
            encryptedFields,
            revision: body.expectedRevision + 1,
            lastMutationId: body.mutationId,
            lastMutationHashEncrypted,
          },
        });
        if (note) {
          const data = {
            status: 'COMPLETED' as const,
            content: note as unknown as Prisma.InputJsonValue,
            riskSeverity: note.riskFlags.severity.toUpperCase() as
              | 'NONE'
              | 'LOW'
              | 'MEDIUM'
              | 'HIGH'
              | 'CRITICAL',
          };
          await tx.noteDraft.upsert({
            where: { sessionId: id },
            create: { sessionId: id, ...data },
            update: data,
          });
          if (session.status !== 'COMPLETED') {
            await tx.session.update({
              where: { id },
              data: { status: 'COMPLETED', endedAt: new Date() },
            });
            await writeAudit(
              {
                actorType: 'PSYCHOLOGIST',
                actorPsychologistId: auth.value.psychologistId,
                action: 'SESSION_ENDED',
                targetType: 'Session',
                targetId: id,
                metadata: { ...auditMetadataFromRequest(req), source: 'CLINICIAN_WRITTEN' },
              },
              tx,
            );
          }
        }
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'NOTE_DRAFT_EDITED',
            targetType: 'Session',
            targetId: id,
            metadata: {
              ...auditMetadataFromRequest(req),
              source: 'CLINICIAN_WRITTEN',
              operation: body.operation,
              revision: body.expectedRevision + 1,
            },
          },
          tx,
        );
      }
      return state(
        await lockedSession(tx, id, auth.value.psychologistId),
        auth.value.psychologistId,
      );
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
