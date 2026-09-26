import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { ScribeRecord, ScribeRecordScope } from './scribe-workspace-store';
import type { ScribeTeleconsultBody } from './scribe-teleconsult-contracts';

const h = vi.hoisted(() => ({
  record: null as ScribeRecord<ScribeTeleconsultBody> | null,
  session: {} as Record<string, unknown>,
  findSession: vi.fn(),
  consents: vi.fn(),
  createConsent: vi.fn(),
  updateSession: vi.fn(),
  audit: vi.fn(),
  removeRoom: vi.fn(),
  accessTokens: [] as Array<{ options: Record<string, unknown>; grant?: Record<string, unknown> }>,
  lock: vi.fn(),
  transaction: vi.fn(),
  updateRecord: vi.fn(),
  createRecord: vi.fn(),
  capabilities: vi.fn(),
  draft: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: { session: { findUnique: h.findSession }, $transaction: h.transaction },
}));
vi.mock('./audit', () => ({ writeAudit: h.audit }));
vi.mock('./capabilities', () => ({ getEffectiveCapabilities: h.capabilities }));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: async (_owner: string, value: string) => value,
}));
vi.mock('./phi-write-lock', () => ({
  lockActiveClient: h.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('./scribe-workspace-store', () => ({
  createScribeRecord: h.createRecord,
  updateScribeRecord: h.updateRecord,
  getScribeRecord: async (scope: ScribeRecordScope, id: string) =>
    h.record?.id === id &&
    h.record.body.psychologistId === scope.psychologistId &&
    h.record.body.sessionId === scope.sessionId
      ? h.record
      : null,
}));
vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    item: { options: Record<string, unknown>; grant?: Record<string, unknown> };
    constructor(_key: string, _secret: string, options: Record<string, unknown>) {
      this.item = { options };
      h.accessTokens.push(this.item);
    }
    addGrant(grant: Record<string, unknown>) {
      this.item.grant = grant;
    }
    async toJwt() {
      return 'synthetic-room-jwt';
    }
  },
  RoomServiceClient: class {
    deleteRoom = h.removeRoom;
  },
}));
import {
  assertScribeTeleconsultDocumentationConsent,
  assertScribeTeleconsultDraftPersistence,
  getPublicScribeTeleconsult,
  getScribeTeleconsultManagement,
  manageScribeTeleconsult,
  publicScribeTeleconsultToken,
  scribeTeleconsultStatus,
  setPublicScribeTeleconsultConsent,
  assertScribeTeleconsultRetainedAiConsent,
} from './scribe-teleconsult';
import {
  signScribeTeleconsultLink,
  scribeTeleconsultId,
  verifyScribeTeleconsultLink,
  assertScribeTeleconsultLinkBinding,
} from './scribe-teleconsult-links';
import { SCRIBE_CONSENT_SCOPES } from './consent-gate';

const owner = 'doctor-a';
const sessionId = 'encounter-a';
const patient = 'patient-a';
const now = new Date('2026-09-26T09:00:00Z');
const scopes = SCRIBE_CONSENT_SCOPES.map((scope) => ({
  scope,
  status: 'GRANTED',
  withdrawnAt: null,
  expiresAt: null,
}));
const tx = {
  session: { findUnique: h.findSession, update: h.updateSession },
  consent: { findMany: h.consents, create: h.createConsent },
  noteDraft: { findUnique: h.draft },
  $queryRaw: async () => [{ exists: true }],
  scribeWorkspaceRecord: {
    findFirst: async () =>
      h.record
        ? {
            ...h.record,
            psychologistId: owner,
            bodyEncrypted: JSON.stringify(h.record.body),
            createdAt: now,
            updatedAt: now,
          }
        : null,
  },
} as unknown as Prisma.TransactionClient;
function fixture(overrides: Partial<ScribeTeleconsultBody> = {}) {
  return {
    id: scribeTeleconsultId(sessionId),
    revision: 1,
    clientId: patient,
    sessionId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    body: {
      product: 'SCRIBE' as const,
      psychologistId: owner,
      clientId: patient,
      sessionId,
      linkVersion: '4a7df915-3e69-45bc-ab54-9c1e4d363a88',
      status: 'open' as const,
      expiresAt: new Date(now.getTime() + 3600_000).toISOString(),
      patientConsent: 'pending' as const,
      patientConsentAt: null,
      documentationState: 'idle' as const,
      documentationHeartbeatAt: null,
      documentationStartedAt: null,
      ...overrides,
    },
  };
}
function link() {
  return signScribeTeleconsultLink(h.record!.id, h.record!.body);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('SCRIBE_TELECONSULT_ENABLED', 'true');
  vi.stubEnv(
    'SCRIBE_TELECONSULT_LINK_SECRET',
    'synthetic-test-only-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  );
  vi.stubEnv('LIVEKIT_URL', 'wss://video.example.test');
  vi.stubEnv('LIVEKIT_API_KEY', 'test-key');
  vi.stubEnv('LIVEKIT_API_SECRET', 'test-secret');
  h.record = fixture();
  h.accessTokens.length = 0;
  h.session = {
    id: sessionId,
    psychologistId: owner,
    clientId: patient,
    status: 'SCHEDULED',
    consentSnapshot: { entries: SCRIBE_CONSENT_SCOPES.map((scope) => ({ scope })) },
    therapyNote: null,
    client: { deletedAt: null, status: 'ACTIVE', psychologistId: owner },
    psychologist: { deletedAt: null, vertical: 'DOCTOR', status: 'ACTIVE' },
  };
  h.findSession.mockImplementation(async () => h.session);
  h.consents.mockResolvedValue(scopes);
  h.createConsent.mockResolvedValue({ id: 'consent-id' });
  h.removeRoom.mockResolvedValue(undefined);
  h.capabilities.mockResolvedValue({
    capabilities: new Set(['MEDICAL_DOCUMENTATION', 'LIVE_ENCOUNTER', 'AMBIENT_CAPTURE']),
  });
  h.draft.mockResolvedValue(null);
  h.transaction.mockImplementation(async (callback) => callback(tx));
  h.updateSession.mockImplementation(async ({ data }) => {
    h.session = { ...h.session, ...data };
    return h.session;
  });
  h.updateRecord.mockImplementation(
    async (
      scope: ScribeRecordScope,
      _id: string,
      revision: number,
      body: ScribeTeleconsultBody,
    ) => {
      await scope.guard?.(tx);
      if (h.record?.revision !== revision) throw new Error('revision conflict');
      h.record = { ...h.record, revision: revision + 1, body };
      return h.record;
    },
  );
  h.createRecord.mockImplementation(
    async (scope: ScribeRecordScope, body: ScribeTeleconsultBody) => {
      await scope.guard?.(tx);
      h.record = fixture(body);
      return h.record;
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Scribe teleconsult links and lifecycle', () => {
  it('uses a strong dedicated secret and has no development fallback', () => {
    vi.stubEnv('SCRIBE_TELECONSULT_LINK_SECRET', '');
    expect(() => link()).toThrow('not configured');
    vi.stubEnv('SCRIBE_TELECONSULT_LINK_SECRET', 'a'.repeat(64));
    expect(() => link()).toThrow('not configured');
  });
  it('binds signed links to the product, patient, owner, encounter, generation and expiry', () => {
    const token = link();
    const payload = verifyScribeTeleconsultLink(token, h.record!.id);
    expect(payload.product).toBe('SCRIBE');
    expect(() => verifyScribeTeleconsultLink(`${token.slice(0, -2)}xx`, h.record!.id)).toThrow();
    expect(() => verifyScribeTeleconsultLink(token, 'other-record')).toThrow();
    for (const key of [
      'psychologistId',
      'clientId',
      'sessionId',
      'linkVersion',
      'expiresAt',
    ] as const) {
      expect(() =>
        assertScribeTeleconsultLinkBinding(payload, { ...h.record!.body, [key]: 'other' }),
      ).toThrow();
    }
  });
  it('only exposes the patient invitation on create/rotate, never on metadata GET', async () => {
    h.record = null;
    const created = await manageScribeTeleconsult(
      owner,
      sessionId,
      { action: 'create-link' },
      'https://scribe.example.test',
    );
    expect(created).toMatchObject({
      configured: true,
      joinUrl: expect.stringContaining('/p/scribe/teleconsult/'),
    });
    expect(JSON.stringify(created)).not.toContain('patient-a');
    expect(await getScribeTeleconsultManagement(owner, sessionId)).not.toHaveProperty('joinUrl');
  });
  it('denies a different doctor and an inactive/deleted/reassigned patient', async () => {
    await expect(getScribeTeleconsultManagement('doctor-b', sessionId)).rejects.toMatchObject({
      status: 404,
    });
    for (const client of [
      { deletedAt: now, status: 'ACTIVE', psychologistId: owner },
      { deletedAt: null, status: 'PAUSED', psychologistId: owner },
      { deletedAt: null, status: 'ACTIVE', psychologistId: 'other' },
    ]) {
      h.session.client = client;
      await expect(getPublicScribeTeleconsult(h.record!.id, link())).rejects.toMatchObject({
        status: 404,
      });
    }
  });
  it.each(['MEDICAL_DOCUMENTATION', 'LIVE_ENCOUNTER'])(
    'revoked owner %s permission denies public status and both join roles',
    async (missing) => {
      h.capabilities.mockResolvedValue({
        capabilities: new Set(
          ['MEDICAL_DOCUMENTATION', 'LIVE_ENCOUNTER'].filter((value) => value !== missing),
        ),
      });
      await expect(getPublicScribeTeleconsult(h.record!.id, link())).rejects.toMatchObject({
        status: 403,
      });
      await expect(publicScribeTeleconsultToken(h.record!.id, link())).rejects.toMatchObject({
        status: 403,
      });
      await expect(
        manageScribeTeleconsult(owner, sessionId, { action: 'token' }, ''),
      ).rejects.toMatchObject({ status: 403 });
      expect(h.accessTokens).toHaveLength(0);
    },
  );
  it.each(['pending', 'declined', 'withdrawn'] as const)(
    'allows joining video without documentation consent: %s',
    async (consent) => {
      h.record = fixture({ patientConsent: consent });
      const result = await publicScribeTeleconsultToken(h.record.id, link());
      expect(result).toMatchObject({
        canJoin: true,
        canDocument: false,
        token: 'synthetic-room-jwt',
      });
      expect(h.accessTokens[0]?.options).toMatchObject({
        identity: `patient_${h.record.id}`,
        ttl: 60,
      });
      expect(h.accessTokens[0]?.grant).toMatchObject({
        roomJoin: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
    },
  );
  it('scopes doctor and patient identities to the Scribe room without display names', async () => {
    await manageScribeTeleconsult(
      owner,
      sessionId,
      { action: 'token' },
      'https://scribe.example.test',
    );
    expect(h.accessTokens[0]?.options).toMatchObject({
      identity: `doctor_${h.record!.id}`,
      name: 'Doctor',
    });
    expect(JSON.parse(h.accessTokens[0]!.options.metadata as string)).toMatchObject({
      product: 'SCRIBE',
      role: 'doctor',
      sessionId,
      clientId: patient,
      ownerId: owner,
    });
    expect(h.accessTokens[0]?.grant?.room).toMatch(/^scribe_/);
  });
  it.each(['revoked', 'ended', 'expired'] as const)(
    'refuses new room tokens when %s',
    async (status) => {
      h.record = fixture(status === 'expired' ? { expiresAt: now.toISOString() } : { status });
      expect(await getPublicScribeTeleconsult(h.record.id, link())).toMatchObject({
        status,
        canJoin: false,
      });
      await expect(publicScribeTeleconsultToken(h.record.id, link())).rejects.toMatchObject({
        status: 409,
      });
      expect(h.accessTokens).toHaveLength(0);
    },
  );
  it('invalidates the old patient link on rotation and pauses documentation', async () => {
    const previous = link();
    const result = await manageScribeTeleconsult(
      owner,
      sessionId,
      { action: 'rotate', expectedRevision: 1 },
      'https://scribe.example.test',
    );
    expect(result).toMatchObject({
      record: { documentationState: 'paused', patientConsent: 'pending' },
      roomTermination: 'confirmed',
    });
    await expect(getPublicScribeTeleconsult(h.record!.id, previous)).rejects.toMatchObject({
      status: 404,
    });
    expect(h.removeRoom).toHaveBeenCalledOnce();
  });
  it('keeps an existing call open for completed/signed review, without permitting new AI or rotation', async () => {
    h.session.status = 'COMPLETED';
    h.session.therapyNote = { signedAt: now };
    expect(await getScribeTeleconsultManagement(owner, sessionId)).toMatchObject({
      record: { status: 'open', canJoin: true, canDocument: false, documentationState: 'finished' },
    });
    expect(await manageScribeTeleconsult(owner, sessionId, { action: 'token' }, '')).toMatchObject({
      canJoin: true,
      canDocument: false,
    });
    await expect(
      manageScribeTeleconsult(owner, sessionId, { action: 'rotate' }, ''),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    expect(await manageScribeTeleconsult(owner, sessionId, { action: 'end' }, '')).toMatchObject({
      record: { status: 'ended' },
      roomTermination: 'confirmed',
    });
  });
  it('fails closed after revoke even if room termination cannot be confirmed', async () => {
    h.removeRoom.mockRejectedValue(new Error('network unavailable'));
    expect(await manageScribeTeleconsult(owner, sessionId, { action: 'revoke' }, '')).toMatchObject(
      { record: { status: 'revoked' }, roomTermination: 'unconfirmed' },
    );
    await expect(publicScribeTeleconsultToken(h.record!.id, link())).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('separate patient and doctor documentation authorization', () => {
  it('requires patient grant and explicit doctor confirmation before first preparation', async () => {
    await expect(
      manageScribeTeleconsult(
        owner,
        sessionId,
        { action: 'documentation', state: 'preparing', confirmedConsent: true },
        '',
      ),
    ).rejects.toMatchObject({ status: 409 });
    h.record = fixture({ patientConsent: 'granted' });
    await expect(
      manageScribeTeleconsult(
        owner,
        sessionId,
        { action: 'documentation', state: 'preparing' },
        '',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(h.updateRecord).not.toHaveBeenCalled();
  });
  it('atomically snapshots REMOTE_LINK scopes once; heartbeat never regrants withdrawn standing consent', async () => {
    h.record = fixture({ patientConsent: 'granted' });
    h.consents.mockResolvedValue([]);
    const input = { action: 'documentation', state: 'preparing', confirmedConsent: true } as const;
    expect(await manageScribeTeleconsult(owner, sessionId, input, '')).toMatchObject({
      record: { documentationState: 'preparing' },
    });
    expect(h.createConsent).toHaveBeenCalledTimes(3);
    expect(h.createConsent).toHaveBeenCalledWith({
      data: expect.objectContaining({ capturedVia: 'REMOTE_LINK' }),
    });
    expect(h.updateSession).toHaveBeenCalledOnce();
    h.consents.mockResolvedValue(
      scopes.map((value) => ({ ...value, status: 'WITHDRAWN', withdrawnAt: now })),
    );
    await expect(
      manageScribeTeleconsult(
        owner,
        sessionId,
        { action: 'documentation', state: 'recording' },
        '',
      ),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    expect(h.createConsent).toHaveBeenCalledTimes(3);
    expect(h.updateSession).toHaveBeenCalledOnce();
  });
  it('withdrawal pauses documentation and immediately blocks server capture authorization', async () => {
    h.record = fixture({
      patientConsent: 'granted',
      documentationState: 'recording',
      documentationHeartbeatAt: now.toISOString(),
      documentationStartedAt: now.toISOString(),
    });
    expect(await setPublicScribeTeleconsultConsent(h.record.id, link(), 'withdrawn')).toMatchObject(
      { patientConsent: 'withdrawn', documentationState: 'paused', canDocument: false },
    );
    expect(h.removeRoom).toHaveBeenCalledOnce();
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
  });
  it('retries opt-out when a heartbeat wins the first CAS, without accepting a rotated link', async () => {
    h.record = fixture({
      patientConsent: 'granted',
      documentationState: 'recording',
      documentationHeartbeatAt: now.toISOString(),
      documentationStartedAt: now.toISOString(),
    });
    const token = link();
    h.updateRecord.mockImplementationOnce(async (scope: ScribeRecordScope) => {
      h.record = { ...h.record!, revision: 2 };
      await scope.guard?.(tx);
      throw new Error('unreachable');
    });
    expect(
      await setPublicScribeTeleconsultConsent(h.record.id, token, 'withdrawn', 1),
    ).toMatchObject({ patientConsent: 'withdrawn', documentationState: 'paused', revision: 3 });
    expect(h.updateRecord).toHaveBeenCalledTimes(2);
    expect(h.record.body.patientConsent).toBe('withdrawn');
  });
  it('keeps stale grants strict, while stale opt-out revisions cannot preserve consent', async () => {
    h.record = fixture({ patientConsent: 'granted' });
    h.record.revision = 3;
    await expect(
      setPublicScribeTeleconsultConsent(h.record.id, link(), 'granted', 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await setPublicScribeTeleconsultConsent(h.record.id, link(), 'declined', 1),
    ).toMatchObject({ patientConsent: 'declined', revision: 4 });
  });
  it('does not retry a link-generation change as a heartbeat conflict', async () => {
    h.record = fixture({ patientConsent: 'granted' });
    h.updateRecord.mockImplementationOnce(async (scope: ScribeRecordScope) => {
      h.record = {
        ...h.record!,
        revision: 2,
        body: { ...h.record!.body, linkVersion: '80a01855-d232-4962-85cf-412c04a3137d' },
      };
      await scope.guard?.(tx);
    });
    await expect(
      setPublicScribeTeleconsultConsent(h.record.id, link(), 'withdrawn', 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.updateRecord).toHaveBeenCalledOnce();
  });
  it.each(['preparing', 'recording', 'draining'] as const)(
    'expires a stale %s heartbeat without claiming recording forever',
    async (state) => {
      h.record = fixture({
        patientConsent: 'granted',
        documentationState: state,
        documentationHeartbeatAt: new Date(now.getTime() - 20_000).toISOString(),
        documentationStartedAt: now.toISOString(),
      });
      expect(scribeTeleconsultStatus(h.record).documentationState).toBe('paused');
      await expect(
        assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner, 'queued-finalization'),
      ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    },
  );
  it('allows fresh preparing capture and consented draining finalization, not new draining capture', async () => {
    h.record = fixture({
      patientConsent: 'granted',
      documentationState: 'preparing',
      documentationHeartbeatAt: now.toISOString(),
      documentationStartedAt: now.toISOString(),
    });
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).resolves.toBeUndefined();
    h.record.body.documentationState = 'draining';
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner, 'queued-finalization'),
    ).resolves.toBeUndefined();
  });
  it('enforces a stored teleconsult even when disabled; nonvideo encounters remain unchanged', async () => {
    vi.stubEnv('SCRIBE_TELECONSULT_ENABLED', 'false');
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    h.record = null;
    await expect(
      assertScribeTeleconsultDocumentationConsent(tx, sessionId, owner),
    ).resolves.toBeUndefined();
  });
  it('permits explicitly incomplete pre-withdrawal draft salvage, not a normal complete save', async () => {
    h.record = fixture({
      patientConsent: 'withdrawn',
      documentationStartedAt: now.toISOString(),
      documentationState: 'paused',
    });
    await expect(
      assertScribeTeleconsultDraftPersistence(tx, sessionId, owner, false),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    await expect(assertScribeTeleconsultDraftPersistence(tx, sessionId, owner, true)).resolves.toBe(
      true,
    );
    h.record.body.documentationStartedAt = null;
    await expect(
      assertScribeTeleconsultDraftPersistence(tx, sessionId, owner, true),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
  });
  it('rechecks ownership inside mutation guard before changing stored state', async () => {
    h.findSession
      .mockResolvedValueOnce(h.session)
      .mockResolvedValueOnce({ ...h.session, psychologistId: 'another-doctor' });
    await expect(
      manageScribeTeleconsult(owner, sessionId, { action: 'revoke' }, ''),
    ).rejects.toMatchObject({ status: 404 });
    expect(h.record?.body.status).toBe('open');
  });
  it('keeps normal post-call review eligible but denies further AI after opt-out, revocation or incomplete capture', async () => {
    h.record = fixture({
      patientConsent: 'granted',
      documentationStartedAt: now.toISOString(),
      status: 'ended',
      documentationState: 'finished',
    });
    await expect(
      assertScribeTeleconsultRetainedAiConsent(tx, sessionId, owner, false),
    ).resolves.toBeUndefined();
    h.record.body.patientConsent = 'withdrawn';
    await expect(
      assertScribeTeleconsultRetainedAiConsent(tx, sessionId, owner, false),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    h.record.body.patientConsent = 'granted';
    h.record.body.status = 'revoked';
    await expect(
      assertScribeTeleconsultRetainedAiConsent(tx, sessionId, owner, false),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
    h.record.body.status = 'ended';
    h.draft.mockResolvedValue({ errorMessage: 'SCRIBE_CAPTURE_INCOMPLETE_V1:capture_interrupted' });
    await expect(
      assertScribeTeleconsultRetainedAiConsent(tx, sessionId, owner, false),
    ).rejects.toMatchObject({ code: 'SESSION_CONSENT_INVALID' });
  });
});
