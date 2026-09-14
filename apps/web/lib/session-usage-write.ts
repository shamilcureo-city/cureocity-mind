import type { Prisma } from '@prisma/client';
import {
  SESSION_USAGE_DOMAIN,
  SessionUsageAckSchema,
  type SessionUsageCommand,
  type SessionUsageReceipt,
} from '@cureocity/contracts';
import { writeAudit } from './audit';
import { assertCurrentCapabilities } from './capabilities';
import { assertValidScribeConsent } from './consent-gate';
import { lockActiveClientForSession, ClientPhiWriteForbiddenError } from './phi-write-lock';
import { isSessionUsageEnabled } from './session-usage-feature';
import { hasSessionUsageConnectionStorage } from './session-usage-storage';
import { sessionUsageHash, validateStoredSessionUsage } from './session-usage-integrity';

export class SessionUsageWriteError extends Error {
  constructor(readonly status: 404 | 409 | 503) {
    super('Usage receipt could not be accepted');
  }
}
const conflict = () => {
  throw new SessionUsageWriteError(409);
};
const units = (value: string) => BigInt(value.replace('.', ''));

function assertProgress(previous: SessionUsageReceipt, next: SessionUsageReceipt) {
  if (
    previous.state === 'FINAL_REPORTED' ||
    (previous.state === 'INCOMPLETE' && next.state !== 'INCOMPLETE') ||
    previous.usageBasis !== next.usageBasis ||
    (previous.endedAt !== null && next.endedAt !== previous.endedAt) ||
    previous.coverageReasons.some((reason) => !next.coverageReasons.includes(reason))
  )
    conflict();
  for (const key of Object.keys(previous.totals) as Array<keyof typeof previous.totals>) {
    const before = previous.totals[key];
    const after = next.totals[key];
    if (
      typeof before === 'string' && typeof after === 'string'
        ? units(after) < units(before)
        : Number(after) < Number(before)
    )
      conflict();
  }
}

/** Caller supplies a transaction; Client -> Session locks serialize receipt retries and erasure. */
export async function writeSessionUsage(tx: Prisma.TransactionClient, input: SessionUsageCommand) {
  const client = await lockActiveClientForSession(tx, input.sessionId, input.psychologistId);
  await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${input.sessionId} FOR UPDATE`;
  const session = await tx.session.findUnique({
    where: { id: input.sessionId },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      status: true,
      captureMode: true,
      mindDocumentationMode: true,
      consentSnapshot: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (
    !session ||
    session.id !== input.sessionId ||
    session.clientId !== client.id ||
    session.psychologistId !== input.psychologistId ||
    session.psychologist.vertical !== input.vertical
  )
    throw new ClientPhiWriteForbiddenError();
  if (!(await hasSessionUsageConnectionStorage(tx))) throw new SessionUsageWriteError(503);
  const row = await tx.sessionUsageConnection.findUnique({
    where: { connectionId: input.connectionId },
  });
  if (
    row &&
    (row.sessionId !== input.sessionId ||
      row.psychologistId !== input.psychologistId ||
      row.clientId !== session.clientId ||
      row.vertical !== input.vertical)
  )
    throw new ClientPhiWriteForbiddenError();
  const previous = row ? validateStoredSessionUsage(row) : null;
  const ack = (
    status: 'REGISTERED' | 'ACCEPTED' | 'DUPLICATE' | 'STALE',
    sequence: number,
    latest: number,
    hash: string | null,
  ) =>
    SessionUsageAckSchema.parse({
      version: 1,
      domain: SESSION_USAGE_DOMAIN,
      connectionId: input.connectionId,
      sessionId: input.sessionId,
      acceptedSequence: sequence,
      latestSequence: latest,
      status,
      payloadHash: hash,
    });

  if (input.type === 'REGISTER') {
    if (row) {
      if (
        row.backend !== input.backend ||
        row.startedAt.toISOString() !== new Date(input.startedAt).toISOString()
      )
        conflict();
      return ack('REGISTERED', 0, row.lastSequence, null);
    }
    // Mind-only first rollout. Receipt drain/read/privacy stay available with the flag off.
    if (!isSessionUsageEnabled() || input.vertical !== 'THERAPIST')
      throw new SessionUsageWriteError(503);
    if (
      session.status !== 'IN_PROGRESS' ||
      session.captureMode !== 'LIVE' ||
      session.mindDocumentationMode === 'MANUAL'
    )
      conflict();
    await assertCurrentCapabilities(input.psychologistId, [
      'LIVE_ENCOUNTER',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
    await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
    await tx.sessionUsageConnection.create({
      data: {
        connectionId: input.connectionId,
        sessionId: input.sessionId,
        psychologistId: input.psychologistId,
        clientId: session.clientId,
        vertical: input.vertical,
        backend: input.backend,
        startedAt: new Date(input.startedAt),
      },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'SESSION_USAGE_REGISTERED',
        targetType: 'SessionUsageConnection',
        targetId: input.connectionId,
        actorPsychologistId: input.psychologistId,
        metadata: { source: 'live-gateway-usage', sessionId: input.sessionId },
      },
      tx,
    );
    return ack('REGISTERED', 0, 0, null);
  }
  // This reports work already incurred; consent/capability revocation stops clinical work,
  // not the accounting acknowledgement. Erasure and current ownership still fail closed.
  if (!row) throw new SessionUsageWriteError(404);
  if (
    (row.backend === 'mock') !== (input.usageBasis === 'MOCK_ZERO') ||
    (input.endedAt !== null && new Date(input.endedAt) < row.startedAt)
  )
    conflict();
  const hash = sessionUsageHash(input);
  if (input.sequence < row.lastSequence)
    return ack('STALE', input.sequence, row.lastSequence, null);
  if (input.sequence === row.lastSequence) {
    if (hash !== row.lastPayloadHash) conflict();
    return ack('DUPLICATE', input.sequence, row.lastSequence, hash);
  }
  if (previous) assertProgress(previous, input);
  await tx.sessionUsageConnection.update({
    where: { connectionId: input.connectionId },
    data: {
      state: input.state,
      endedAt: input.endedAt === null ? null : new Date(input.endedAt),
      lastSequence: input.sequence,
      lastPayloadHash: hash,
      lastReceipt: input,
      costInr: input.totals.costInr,
    },
  });
  await writeAudit(
    {
      actorType: 'SYSTEM',
      action: 'SESSION_USAGE_REPORTED',
      targetType: 'SessionUsageConnection',
      targetId: input.connectionId,
      actorPsychologistId: input.psychologistId,
      metadata: {
        source: 'live-gateway-usage',
        sessionId: input.sessionId,
        sequence: input.sequence,
        state: input.state,
      },
    },
    tx,
  );
  return ack('ACCEPTED', input.sequence, input.sequence, hash);
}
