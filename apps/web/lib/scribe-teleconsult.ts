import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { prisma } from './prisma';
import { decryptForTenant } from './tenant-crypto';
import { lockActiveClient } from './phi-write-lock';
import { hasScribeWorkspaceStorage } from './scribe-workspace-privacy';
import { scribeCaptureIntegrity } from './scribe-capture-integrity';
import { writeAudit } from './audit';
import { getEffectiveCapabilities } from './capabilities';
import {
  assertValidScribeConsent,
  ConsentAuthorizationError,
  SCRIBE_CONSENT_SCOPES,
} from './consent-gate';
import {
  ScribeWorkspaceError,
  ScribeWorkspaceRevisionConflictError,
} from './scribe-workspace-auth';
import {
  createScribeRecord,
  getScribeRecord,
  updateScribeRecord,
  type ScribeRecord,
  type ScribeRecordScope,
} from './scribe-workspace-store';
import {
  SCRIBE_TELECONSULT_HEARTBEAT_MS,
  ScribeTeleconsultBodySchema,
  type ScribeTeleconsultBody,
  type ScribeTeleconsultManagementInput,
  type ScribeTeleconsultPublicStatus,
  type ScribeTeleconsultPatientConsent,
} from './scribe-teleconsult-contracts';
import {
  assertScribeTeleconsultConfigured,
  assertScribeTeleconsultEnabled,
  assertScribeTeleconsultLinkBinding,
  scribeTeleconsultConfigured,
  scribeTeleconsultId,
  signScribeTeleconsultLink,
  verifyScribeTeleconsultLink,
  type ScribeTeleconsultLink,
} from './scribe-teleconsult-links';

type Record = ScribeRecord<ScribeTeleconsultBody>;
type Db = Pick<Prisma.TransactionClient, 'session'>;
const sessionSelect = {
  id: true,
  psychologistId: true,
  clientId: true,
  status: true,
  consentSnapshot: true,
  therapyNote: { select: { signedAt: true } },
  client: { select: { deletedAt: true, status: true, psychologistId: true } },
  psychologist: { select: { deletedAt: true, vertical: true, status: true } },
} satisfies Prisma.SessionSelect;
type Session = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;

async function ownedSession(
  db: Db,
  ownerId: string,
  sessionId: string,
  startable = false,
): Promise<Session> {
  const session = await db.session.findUnique({ where: { id: sessionId }, select: sessionSelect });
  if (
    !session ||
    session.psychologistId !== ownerId ||
    session.client.psychologistId !== ownerId ||
    session.client.deletedAt ||
    session.client.status !== 'ACTIVE' ||
    session.psychologist.deletedAt ||
    session.psychologist.vertical !== 'DOCTOR' ||
    session.psychologist.status !== 'ACTIVE'
  ) {
    throw new ScribeWorkspaceError(404, 'Encounter not found or no longer available.');
  }
  if (
    startable &&
    (session.therapyNote?.signedAt || !['SCHEDULED', 'IN_PROGRESS'].includes(session.status))
  ) {
    throw new ScribeWorkspaceError(409, 'This encounter no longer accepts a teleconsult.');
  }
  return session;
}
function scope(
  body: ScribeTeleconsultBody,
  extra: Partial<ScribeRecordScope> = {},
): ScribeRecordScope {
  return {
    psychologistId: body.psychologistId,
    kind: 'teleconsult',
    clientId: body.clientId,
    sessionId: body.sessionId,
    ...extra,
  };
}
function binding(record: Record): void {
  if (
    record.clientId !== record.body.clientId ||
    record.sessionId !== record.body.sessionId ||
    record.id !== scribeTeleconsultId(record.body.sessionId)
  ) {
    throw new ScribeWorkspaceError(503, 'Teleconsult identity could not be verified.');
  }
}
export function scribeTeleconsultStatus(
  record: Record,
  sessionOpen = true,
  now = Date.now(),
  captureStartable = sessionOpen,
): ScribeTeleconsultPublicStatus {
  const body = record.body;
  const status =
    body.status !== 'open'
      ? body.status
      : !sessionOpen
        ? 'ended'
        : Date.parse(body.expiresAt) <= now
          ? 'expired'
          : 'open';
  const canJoin = status === 'open';
  const fresh =
    body.documentationHeartbeatAt !== null &&
    now - Date.parse(body.documentationHeartbeatAt) < SCRIBE_TELECONSULT_HEARTBEAT_MS;
  const documentationState =
    !captureStartable || body.status === 'ended'
      ? 'finished'
      : ['preparing', 'recording', 'draining'].includes(body.documentationState) &&
          (!fresh || !canJoin || body.patientConsent !== 'granted')
        ? 'paused'
        : body.documentationState;
  return {
    id: record.id,
    revision: record.revision,
    linkVersion: body.linkVersion,
    status,
    expiresAt: body.expiresAt,
    patientConsent: body.patientConsent,
    patientConsentAt: body.patientConsentAt,
    documentationState,
    documentationHeartbeatAt: body.documentationHeartbeatAt,
    canJoin,
    canDocument: canJoin && captureStartable && body.patientConsent === 'granted',
  };
}
function isOpen(session: Session): boolean {
  return !session.therapyNote?.signedAt && ['SCHEDULED', 'IN_PROGRESS'].includes(session.status);
}
function isCallOpen(session: Session): boolean {
  return ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'].includes(session.status);
}
function statusForSession(record: Record, session: Session): ScribeTeleconsultPublicStatus {
  return scribeTeleconsultStatus(record, isCallOpen(session), Date.now(), isOpen(session));
}
function assertOpen(record: Record, session: Session): void {
  if (!statusForSession(record, session).canJoin) {
    throw new ScribeWorkspaceError(409, 'This teleconsult is closed or expired.');
  }
}
async function findRecord(ownerId: string, sessionId: string): Promise<Record | null> {
  const record = await getScribeRecord(
    { psychologistId: ownerId, kind: 'teleconsult', sessionId },
    scribeTeleconsultId(sessionId),
    ScribeTeleconsultBodySchema,
  );
  if (record) binding(record);
  return record;
}
async function txRecord(
  tx: Prisma.TransactionClient,
  ownerId: string,
  sessionId: string,
): Promise<Record | null> {
  const row = await tx.scribeWorkspaceRecord.findFirst({
    where: {
      id: scribeTeleconsultId(sessionId),
      psychologistId: ownerId,
      kind: 'teleconsult',
      sessionId,
    },
  });
  if (!row) return null;
  try {
    const plaintext = await decryptForTenant(ownerId, row.bodyEncrypted);
    const record: Record = {
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      body: ScribeTeleconsultBodySchema.parse(JSON.parse(plaintext ?? 'null')),
    };
    binding(record);
    return record;
  } catch {
    throw new ScribeWorkspaceError(503, 'Teleconsult state could not be verified.');
  }
}
function assertRevision(record: Record, expected?: number): void {
  if (expected !== undefined && record.revision !== expected) {
    throw new ScribeWorkspaceRevisionConflictError(
      'This call changed. Refresh before trying again.',
    );
  }
}
function roomName(record: Record): string {
  return `scribe_${record.id}_${record.body.linkVersion}`;
}
async function assertCurrentCallCapabilities(ownerId: string): Promise<void> {
  const effective = await getEffectiveCapabilities(ownerId);
  if (
    !effective.capabilities.has('MEDICAL_DOCUMENTATION') ||
    !effective.capabilities.has('LIVE_ENCOUNTER')
  ) {
    throw new ScribeWorkspaceError(403, 'This teleconsult is no longer available.');
  }
}
async function stopRoom(record: Record): Promise<'confirmed' | 'unconfirmed'> {
  try {
    const url = new URL(process.env['LIVEKIT_URL'] ?? '');
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol;
    const client = new RoomServiceClient(
      url.toString(),
      process.env['LIVEKIT_API_KEY'],
      process.env['LIVEKIT_API_SECRET'],
      { requestTimeout: 5 },
    );
    await client.deleteRoom(roomName(record));
    return 'confirmed';
  } catch {
    // State is already closed even if LiveKit is unavailable. Never claim a remote disconnect succeeded.
    return 'unconfirmed';
  }
}
async function mint(record: Record, role: 'doctor' | 'patient') {
  assertScribeTeleconsultConfigured();
  const at = new AccessToken(process.env['LIVEKIT_API_KEY']!, process.env['LIVEKIT_API_SECRET']!, {
    identity: `${role}_${record.id}`,
    name: role === 'doctor' ? 'Doctor' : 'Patient',
    ttl: 60,
    metadata: JSON.stringify({
      product: 'SCRIBE',
      role,
      sessionId: record.body.sessionId,
      clientId: record.body.clientId,
      ownerId: record.body.psychologistId,
      linkVersion: record.body.linkVersion,
    }),
  });
  at.addGrant({
    room: roomName(record),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { token: await at.toJwt(), url: process.env['LIVEKIT_URL']!, roomName: roomName(record) };
}
async function lockedToken(
  record: Record,
  role: 'doctor' | 'patient',
  link?: ScribeTeleconsultLink,
) {
  return prisma.$transaction(async (tx) => {
    await lockActiveClient(tx, record.body.clientId, record.body.psychologistId);
    await tx.$queryRaw`SELECT "id" FROM "psychologists" WHERE "id" = ${record.body.psychologistId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${record.body.sessionId} FOR UPDATE`;
    const session = await ownedSession(tx, record.body.psychologistId, record.body.sessionId);
    await assertCurrentCallCapabilities(record.body.psychologistId);
    const current = await txRecord(tx, record.body.psychologistId, record.body.sessionId);
    if (!current) throw new ScribeWorkspaceError(404, 'Teleconsult not found.');
    if (link) assertScribeTeleconsultLinkBinding(link, current.body);
    assertOpen(current, session);
    return { ...statusForSession(current, session), ...(await mint(current, role)) };
  });
}

/** This first explicit remote acknowledgement and its standing grants commit with the record CAS. */
async function acknowledgeInitialConsent(
  tx: Prisma.TransactionClient,
  session: Session,
  now: string,
): Promise<void> {
  if (session.status !== 'SCHEDULED') {
    // Never manufacture a new acknowledgement on resume or an already running encounter.
    await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
    return;
  }
  const standing = await tx.consent.findMany({
    where: {
      clientId: session.clientId,
      scope: { in: [...SCRIBE_CONSENT_SCOPES] },
      status: 'GRANTED',
      withdrawnAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
    },
    select: { scope: true },
  });
  const granted = new Set(standing.map((row) => row.scope));
  for (const consentScope of SCRIBE_CONSENT_SCOPES.filter((value) => !granted.has(value))) {
    const consent = await tx.consent.create({
      data: {
        clientId: session.clientId,
        psychologistId: session.psychologistId,
        scope: consentScope,
        status: 'GRANTED',
        scriptVersion: 'v1.0',
        capturedVia: 'REMOTE_LINK',
        grantedAt: new Date(now),
        notes: 'Explicit Scribe teleconsult patient and doctor confirmation.',
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: session.psychologistId,
        action: 'CONSENT_GRANTED',
        targetType: 'Consent',
        targetId: consent.id,
        metadata: { scope: consentScope, clientId: session.clientId, source: 'SCRIBE_TELECONSULT' },
      },
      tx,
    );
  }
  await tx.session.update({
    where: { id: session.id },
    data: {
      consentSnapshot: {
        entries: SCRIBE_CONSENT_SCOPES.map((value) => ({
          scope: value,
          scriptVersion: 'v1.0',
          ackedAt: now,
        })),
        notes: null,
        captureMode: 'LIVE',
        ambientCaptureDeclined: false,
      },
    },
  });
  await writeAudit(
    {
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: session.psychologistId,
      action: 'SESSION_CONSENT_RECORDED',
      targetType: 'Session',
      targetId: session.id,
      metadata: {
        scopes: [...SCRIBE_CONSENT_SCOPES],
        scriptVersion: 'v1.0',
        source: 'SCRIBE_TELECONSULT',
      },
    },
    tx,
  );
}

export async function getScribeTeleconsultManagement(ownerId: string, sessionId: string) {
  assertScribeTeleconsultEnabled();
  const session = await ownedSession(prisma, ownerId, sessionId);
  const record = await findRecord(ownerId, sessionId);
  return {
    record: record ? statusForSession(record, session) : null,
    configured: scribeTeleconsultConfigured(),
  };
}
export async function manageScribeTeleconsult(
  ownerId: string,
  sessionId: string,
  input: ScribeTeleconsultManagementInput,
  origin: string,
) {
  assertScribeTeleconsultEnabled();
  const session = await ownedSession(prisma, ownerId, sessionId);
  const existing = await findRecord(ownerId, sessionId);
  const now = new Date().toISOString();
  if (input.action === 'create-link') {
    assertScribeTeleconsultConfigured();
    if (existing)
      throw new ScribeWorkspaceError(409, 'A call already exists. Refresh or rotate its link.');
    const body: ScribeTeleconsultBody = {
      product: 'SCRIBE',
      psychologistId: ownerId,
      clientId: session.clientId,
      sessionId,
      linkVersion: randomUUID(),
      status: 'open',
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      patientConsent: 'pending',
      patientConsentAt: null,
      documentationState: 'idle',
      documentationHeartbeatAt: null,
      documentationStartedAt: null,
    };
    const record = await createScribeRecord(
      scope(body, {
        requireUnsigned: true,
        guard: async (tx) => {
          await ownedSession(tx, ownerId, sessionId, true);
        },
      }),
      body,
      scribeTeleconsultId(sessionId),
    );
    return {
      record: scribeTeleconsultStatus(record),
      configured: true,
      joinUrl: `${origin}/p/scribe/teleconsult/${record.id}#token=${signScribeTeleconsultLink(record.id, body)}`,
    };
  }
  if (!existing) throw new ScribeWorkspaceError(404, 'Teleconsult not found.');
  if (input.action === 'token') return lockedToken(existing, 'doctor');
  assertRevision(existing, input.expectedRevision);
  let body: ScribeTeleconsultBody = { ...existing.body };
  let mustBeOpen = false;
  if (input.action === 'rotate') {
    assertScribeTeleconsultConfigured();
    if (existing.body.status === 'ended')
      throw new ScribeWorkspaceError(409, 'An ended call cannot be reopened.');
    if (!isOpen(session)) throw new ScribeWorkspaceError(409, 'This encounter is closed.');
    body = {
      ...body,
      status: 'open',
      linkVersion: randomUUID(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      patientConsent: 'pending',
      patientConsentAt: null,
      documentationState: 'paused',
      documentationHeartbeatAt: null,
    };
  } else if (input.action === 'end' || input.action === 'revoke') {
    body.status = input.action === 'end' ? 'ended' : 'revoked';
    body.documentationState = input.action === 'end' ? 'finished' : 'paused';
    body.documentationHeartbeatAt = null;
  } else {
    mustBeOpen = ['preparing', 'recording', 'draining'].includes(input.state);
    if (mustBeOpen) {
      assertScribeTeleconsultConfigured();
      assertOpen(existing, session);
      if (body.patientConsent !== 'granted')
        throw new ScribeWorkspaceError(409, 'The patient has not agreed to AI documentation.');
      if (!body.documentationStartedAt && !input.confirmedConsent)
        throw new ScribeWorkspaceError(
          409,
          'Confirm the patient consent discussion before starting documentation.',
        );
      body.documentationStartedAt ??= now;
    }
    body.documentationState = input.state;
    body.documentationHeartbeatAt = mustBeOpen ? now : null;
  }
  const record = await updateScribeRecord(
    scope(body, {
      requireUnsigned: mustBeOpen || input.action === 'rotate',
      guard: async (tx) => {
        const currentSession = await ownedSession(
          tx,
          ownerId,
          sessionId,
          mustBeOpen || input.action === 'rotate',
        );
        const current = await txRecord(tx, ownerId, sessionId);
        if (!current) throw new ScribeWorkspaceError(404, 'Teleconsult not found.');
        assertRevision(current, existing.revision);
        if (mustBeOpen) {
          assertOpen(current, currentSession);
          if (current.body.patientConsent !== 'granted')
            throw new ScribeWorkspaceError(
              409,
              'Patient consent changed. Documentation is paused.',
            );
          if (
            !current.body.documentationStartedAt &&
            input.action === 'documentation' &&
            input.confirmedConsent
          )
            await acknowledgeInitialConsent(tx, currentSession, now);
          else
            await assertValidScribeConsent(
              currentSession.consentSnapshot,
              currentSession.clientId,
              tx,
            );
        }
      },
    }),
    existing.id,
    existing.revision,
    body,
  );
  const termination = ['rotate', 'revoke', 'end'].includes(input.action)
    ? await stopRoom(existing)
    : undefined;
  return {
    record: statusForSession(record, session),
    configured: scribeTeleconsultConfigured(),
    ...(input.action === 'rotate'
      ? {
          joinUrl: `${origin}/p/scribe/teleconsult/${record.id}#token=${signScribeTeleconsultLink(record.id, body)}`,
        }
      : {}),
    ...(termination ? { roomTermination: termination } : {}),
  };
}
async function publicRecord(id: string, token: string) {
  assertScribeTeleconsultConfigured();
  const link = verifyScribeTeleconsultLink(token, id);
  const session = await ownedSession(prisma, link.psychologistId, link.sessionId);
  await assertCurrentCallCapabilities(link.psychologistId);
  const record = await findRecord(link.psychologistId, link.sessionId);
  if (!record || record.id !== id || record.body.clientId !== session.clientId)
    throw new ScribeWorkspaceError(404, 'This teleconsult link is unavailable.');
  assertScribeTeleconsultLinkBinding(link, record.body);
  return { record, link, session };
}
export async function getPublicScribeTeleconsult(id: string, token: string) {
  const { record, session } = await publicRecord(id, token);
  return statusForSession(record, session);
}
export async function publicScribeTeleconsultToken(id: string, token: string) {
  const { record, link } = await publicRecord(id, token);
  return lockedToken(record, 'patient', link);
}
export async function setPublicScribeTeleconsultConsent(
  id: string,
  token: string,
  consent: Exclude<ScribeTeleconsultPatientConsent, 'pending'>,
  expectedRevision?: number,
) {
  // Opting out must not lose to a routine doctor heartbeat. Each retry reauthenticates
  // the exact link generation and rebuilds the mutation from the latest record.
  for (let attempt = 0; ; attempt++) {
    try {
      return await mutatePublicConsent(id, token, consent, expectedRevision);
    } catch (error) {
      if (
        consent === 'granted' ||
        !(error instanceof ScribeWorkspaceRevisionConflictError) ||
        attempt >= 2
      )
        throw error;
    }
  }
}
async function mutatePublicConsent(
  id: string,
  token: string,
  consent: Exclude<ScribeTeleconsultPatientConsent, 'pending'>,
  expectedRevision?: number,
) {
  const { record: existing, link, session } = await publicRecord(id, token);
  if (consent === 'granted') assertRevision(existing, expectedRevision);
  assertOpen(existing, session);
  const body: ScribeTeleconsultBody = {
    ...existing.body,
    patientConsent: consent,
    patientConsentAt: new Date().toISOString(),
    ...(consent !== 'granted'
      ? { documentationState: 'paused', documentationHeartbeatAt: null }
      : {}),
  };
  const record = await updateScribeRecord(
    scope(body, {
      actorType: 'SYSTEM',
      guard: async (tx) => {
        const currentSession = await ownedSession(
          tx,
          body.psychologistId,
          body.sessionId,
          consent === 'granted',
        );
        const current = await txRecord(tx, body.psychologistId, body.sessionId);
        if (!current) throw new ScribeWorkspaceError(404, 'This teleconsult link is unavailable.');
        assertScribeTeleconsultLinkBinding(link, current.body);
        assertOpen(current, currentSession);
        assertRevision(current, existing.revision);
        await writeAudit(
          {
            actorType: 'SYSTEM',
            action: 'SCRIBE_WORKSPACE_UPDATED',
            targetType: 'ScribeWorkspaceRecord',
            targetId: id,
            metadata: {
              kind: 'teleconsult',
              operation: 'patient_consent',
              decision: consent,
              sessionId: body.sessionId,
              linkVersion: body.linkVersion,
            },
          },
          tx,
        );
      },
    }),
    existing.id,
    existing.revision,
    body,
  );
  if (
    consent !== 'granted' &&
    ['preparing', 'recording', 'draining'].includes(existing.body.documentationState)
  )
    await stopRoom(existing);
  return statusForSession(record, session);
}

/** Called inside the existing client-consent transaction, independent of browser headers. */
export async function assertScribeTeleconsultDocumentationConsent(
  tx: Prisma.TransactionClient,
  sessionId: string,
  ownerId: string,
  purpose: 'capture' | 'queued-finalization' = 'capture',
): Promise<void> {
  try {
    // Older installations with no workspace table cannot contain teleconsult records.
    if (!(await hasScribeWorkspaceStorage(tx))) return;
    const record = await txRecord(tx, ownerId, sessionId);
    if (!record) return; // In-person Scribe encounters retain their existing consent flow.
    assertScribeTeleconsultConfigured();
    const session = await ownedSession(tx, ownerId, sessionId, true);
    const status = statusForSession(record, session);
    const staleRecording =
      ['preparing', 'recording', 'draining'].includes(record.body.documentationState) &&
      status.documentationState === 'paused';
    if (
      !status.canDocument ||
      !record.body.documentationStartedAt ||
      staleRecording ||
      (purpose === 'capture' && !['preparing', 'recording'].includes(status.documentationState))
    ) {
      throw new ScribeWorkspaceError(
        409,
        'Teleconsult documentation is paused or patient consent is no longer valid.',
      );
    }
  } catch {
    throw new ConsentAuthorizationError(
      'Teleconsult documentation authorization could not be confirmed. Stop capture and refresh the call.',
    );
  }
}

/**
 * Saving an already-produced draft is not a new AI operation. After interruption,
 * retain it only as explicitly incomplete, with the existing review/sign gate.
 * No previous capture authority means there is no lawful teleconsult draft to salvage.
 */
export async function assertScribeTeleconsultDraftPersistence(
  tx: Prisma.TransactionClient,
  sessionId: string,
  ownerId: string,
  captureIncomplete: boolean | undefined,
): Promise<boolean> {
  if (!(await hasScribeWorkspaceStorage(tx))) return false;
  const record = await txRecord(tx, ownerId, sessionId);
  if (!record) return false;
  if (!record.body.documentationStartedAt) {
    throw new ConsentAuthorizationError(
      'Teleconsult documentation was never authorized. No new draft was saved.',
    );
  }
  const session = await ownedSession(tx, ownerId, sessionId);
  const status = statusForSession(record, session);
  let interrupted =
    !scribeTeleconsultConfigured() ||
    !status.canJoin ||
    record.body.patientConsent !== 'granted' ||
    (['preparing', 'recording', 'draining'].includes(record.body.documentationState) &&
      status.documentationState === 'paused');
  try {
    await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
  } catch (error) {
    if (!(error instanceof ConsentAuthorizationError)) throw error;
    interrupted = true;
  }
  if (interrupted && !captureIncomplete) {
    throw new ConsentAuthorizationError(
      'Teleconsult capture was interrupted. Save the captured draft as incomplete for review; no new draft was saved.',
    );
  }
  return interrupted;
}

/** Standing preferences cannot silently override an encounter-specific remote opt-out. */
export async function assertScribeTeleconsultRetainedAiConsent(
  tx: Prisma.TransactionClient,
  sessionId: string,
  ownerId: string,
  captureActive: boolean,
): Promise<void> {
  if (!(await hasScribeWorkspaceStorage(tx))) return;
  const record = await txRecord(tx, ownerId, sessionId);
  if (!record) return;
  if (captureActive) {
    await assertScribeTeleconsultDocumentationConsent(tx, sessionId, ownerId);
    return;
  }
  assertScribeTeleconsultEnabled();
  const draft = await tx.noteDraft.findUnique({
    where: { sessionId },
    select: { errorMessage: true },
  });
  if (
    !record.body.documentationStartedAt ||
    record.body.patientConsent !== 'granted' ||
    record.body.status === 'revoked' ||
    scribeCaptureIntegrity(draft?.errorMessage).incomplete
  ) {
    throw new ConsentAuthorizationError(
      'Teleconsult documentation requires clinician review without further AI processing.',
    );
  }
}
