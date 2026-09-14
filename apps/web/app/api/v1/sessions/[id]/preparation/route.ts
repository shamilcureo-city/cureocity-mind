import { type NextRequest } from 'next/server';
import {
  MindSessionPreparationBodySchema,
  MindSessionPreparationResponseSchema,
  MindSessionPreparationSaveResponseSchema,
  SaveMindSessionPreparationInputSchema,
} from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { privateJson, privateResponse } from '@/lib/private-response';
import { ClientPhiWriteForbiddenError } from '@/lib/phi-write-lock';
import {
  lockMindPreparationSession,
  MindSessionPreparationUnreadableError,
  toOwnedMindSessionPreparationDto,
} from '@/lib/mind-session-preparation';
import { isMindSessionPreparationEnabled } from '@/lib/mind-session-preparation-feature';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const notFound = () => privateJson({ error: 'Session not found' }, { status: 404 });
const unavailable = () =>
  privateJson(
    { error: 'Preparation is temporarily unavailable. Keep your draft and try again.' },
    { status: 503 },
  );
const unreadable = () =>
  privateJson(
    {
      error:
        'The saved preparation could not be read. It has not been replaced. Contact support before changing it.',
    },
    { status: 503 },
  );
const conflict = (error: string) => privateJson({ error }, { status: 409 });

function failure(error: unknown) {
  if (error instanceof ClientPhiWriteForbiddenError) return notFound();
  if (error instanceof MindSessionPreparationUnreadableError) return unreadable();
  // Includes a migration not yet installed, KMS/network and audit failures. Do not
  // leak database details or advertise unreadable/unavailable storage as no record.
  return unavailable();
}

export async function GET(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') return notFound();
  const { id: sessionId } = await params;
  try {
    // Deliberately independent of the editing flag: disabling new writes must not
    // make existing clinical records inaccessible during a compatible rollback.
    return await prisma.$transaction(
      async (tx) => {
        const session = await lockMindPreparationSession(tx, sessionId, auth.value.psychologistId);
        const row = await tx.mindSessionPreparation.findFirst({
          where: { sessionId },
          orderBy: { revision: 'desc' },
        });
        const preparation = row
          ? await toOwnedMindSessionPreparationDto(row, sessionId, auth.value.psychologistId)
          : null;
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'CLIENT_BRIEFING_VIEWED',
            targetType: 'Session',
            targetId: sessionId,
            metadata: {
              ...auditMetadataFromRequest(req),
              surface: 'mind-session-preparation',
              revision: preparation?.revision ?? 0,
              outcome: 'viewed',
            },
          },
          tx,
        );
        return privateJson(
          MindSessionPreparationResponseSchema.parse({
            sessionId,
            clientId: session.clientId,
            scheduledAt: session.scheduledAt.toISOString(),
            status: session.status,
            preparation,
          }),
        );
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: NextRequest, { params }: Context) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return privateResponse(auth.response);
  if (auth.value.user.vertical !== 'THERAPIST') return notFound();
  if (!isMindSessionPreparationEnabled()) return unavailable();
  const parsed = await parseJson(req, SaveMindSessionPreparationInputSchema);
  if (!parsed.ok) return privateResponse(parsed.response);
  const input = parsed.value;
  const { id: sessionId } = await params;
  const body = MindSessionPreparationBodySchema.parse({
    version: 1,
    focus: input.focus,
    source: 'CLINICIAN_WRITTEN',
    scheduledAt: new Date(input.expectedScheduledAt).toISOString(),
  });
  const serialized = JSON.stringify(body);
  try {
    return await prisma.$transaction(
      async (tx) => {
        const session = await lockMindPreparationSession(tx, sessionId, auth.value.psychologistId);
        // Bind the browser's authored wording to the client it was prepared for,
        // not merely whichever client the session may be linked to at save time.
        if (session.clientId !== input.expectedClientId) return notFound();
        const latest = await tx.mindSessionPreparation.findFirst({
          where: { sessionId },
          orderBy: { revision: 'desc' },
        });
        // Always validate current history, including an old successful-operation retry.
        const current = latest
          ? await toOwnedMindSessionPreparationDto(latest, sessionId, auth.value.psychologistId)
          : null;
        const receipt = await tx.mindSessionPreparation.findFirst({
          where: { sessionId, operationId: input.operationId },
        });
        const response = (
          preparation: NonNullable<typeof current>,
          currentRevision: number,
          replayed: boolean,
          status: number,
        ) =>
          privateJson(
            MindSessionPreparationSaveResponseSchema.parse({
              sessionId,
              clientId: session.clientId,
              scheduledAt: session.scheduledAt.toISOString(),
              status: session.status,
              preparation,
              currentRevision,
              replayed,
            }),
            { status },
          );
        if (receipt) {
          const preparation =
            receipt.id === current?.id
              ? current
              : await toOwnedMindSessionPreparationDto(
                  receipt,
                  sessionId,
                  auth.value.psychologistId,
                );
          if (
            preparation.revision !== input.expectedRevision + 1 ||
            JSON.stringify(preparation.body) !== serialized
          )
            return conflict('This save identifier was already used for different preparation.');
          // A successful lost reply remains acknowledgeable after start/rescheduling,
          // without applying the old focus again or changing the newest revision.
          return response(preparation, current?.revision ?? preparation.revision, true, 200);
        }
        if (session.status !== 'SCHEDULED')
          return conflict(
            'This visit has already started or is no longer scheduled. Preparation is read-only; keep later decisions in the session note.',
          );
        if (session.scheduledAt.toISOString() !== body.scheduledAt)
          return conflict(
            'This visit has been rescheduled. Keep your draft and reopen the visit before saving.',
          );
        if ((current?.revision ?? 0) !== input.expectedRevision)
          return conflict(
            'Newer preparation exists for this visit. Keep your draft and review the saved preparation before trying again.',
          );
        const bodyEncrypted = await encryptForTenant(auth.value.psychologistId, serialized);
        const row = await tx.mindSessionPreparation.create({
          data: {
            sessionId,
            psychologistId: auth.value.psychologistId,
            revision: input.expectedRevision + 1,
            operationId: input.operationId,
            bodyEncrypted,
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'MIND_SESSION_PREPARATION_SAVED',
            targetType: 'MindSessionPreparation',
            targetId: row.id,
            metadata: {
              ...auditMetadataFromRequest(req),
              sessionId,
              clientId: session.clientId,
              revision: row.revision,
              operationId: row.operationId,
              operation: input.action,
              source: body.source,
            },
          },
          tx,
        );
        return response(
          {
            id: row.id,
            sessionId,
            psychologistId: auth.value.psychologistId,
            revision: row.revision,
            operationId: row.operationId,
            createdAt: row.createdAt.toISOString(),
            body,
          },
          row.revision,
          false,
          201,
        );
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    return failure(error);
  }
}
