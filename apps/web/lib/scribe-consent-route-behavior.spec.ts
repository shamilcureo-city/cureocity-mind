import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  owned: vi.fn(),
  current: vi.fn(),
  outer: vi.fn(),
  lock: vi.fn(),
  update: vi.fn(),
  readUpdated: vi.fn(),
  standing: vi.fn(),
  createConsent: vi.fn(),
  audit: vi.fn(),
  signToken: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: h.auth, requireCapability: h.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
vi.mock('./session-helpers', () => ({ fetchOwnedSession: h.owned }));
vi.mock('./mappers', () => ({ toSession: (row: unknown) => row }));
vi.mock('./live-token', () => ({ signLiveToken: h.signToken }));
vi.mock('./scribe-teleconsult', () => ({ assertScribeTeleconsultDocumentationConsent: vi.fn() }));
vi.mock('./patient-context', () => ({ fetchActiveMedications: vi.fn(), fetchAllergies: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: h.outer },
    $transaction: (run: (tx: unknown) => unknown) =>
      run({
        $queryRaw: h.lock,
        session: { findUnique: h.current, updateMany: h.update, findUniqueOrThrow: h.readUpdated },
        consent: { findMany: h.standing, create: h.createConsent },
      }),
  },
}));
import { POST as consent, DELETE as decline } from '../app/api/v1/sessions/[id]/consent/route';
import { POST as start } from '../app/api/v1/sessions/[id]/start/route';
import { POST as token } from '../app/api/v1/sessions/[id]/live-token/route';

const scopes = ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'];
const ctx = { params: Promise.resolve({ id: 'fictional-session' }) };
const complete = (extra = {}) => ({
  entries: scopes.map((scope) => ({
    scope,
    scriptVersion: 'v1.0',
    ackedAt: '2026-10-08T00:00:00.000Z',
  })),
  notes: null,
  ...extra,
});
const refused = () => ({
  entries: [],
  notes: 'Patient declined live ambient capture for this encounter.',
  captureMode: 'LIVE',
  ambientCaptureDeclined: true,
});
let row: Record<string, unknown>;
const req = (body: unknown = {}, method = 'POST') =>
  new NextRequest('https://scribe.cureocity.in/api/v1/sessions/fictional-session/consent', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
  });
const acknowledge = (captureMode?: string) =>
  consent(req({ scopes, scriptVersion: 'v1.0', ...(captureMode ? { captureMode } : {}) }), ctx);
beforeEach(() => {
  vi.clearAllMocks();
  row = {
    id: 'fictional-session',
    psychologistId: 'owner',
    clientId: 'fictional-client',
    status: 'SCHEDULED',
    captureMode: null,
    consentSnapshot: null,
    psychologist: { vertical: 'DOCTOR' },
  };
  h.auth.mockResolvedValue({
    ok: true,
    value: {
      psychologistId: 'owner',
      user: {
        firebaseUid: 'owner-uid',
        vertical: 'DOCTOR',
        capabilities: ['LIVE_ENCOUNTER', 'MEDICAL_DOCUMENTATION'],
      },
    },
  });
  h.owned.mockImplementation(async () => structuredClone(row));
  h.outer.mockImplementation(async () => structuredClone(row));
  h.current.mockImplementation(async () => structuredClone(row));
  h.lock.mockResolvedValue([{ id: 'fictional-client' }]);
  h.standing.mockResolvedValue(
    scopes.map((scope) => ({ scope, status: 'GRANTED', withdrawnAt: null, expiresAt: null })),
  );
  h.update.mockImplementation(async ({ where, data }) => {
    if (where.status !== row.status) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  h.readUpdated.mockImplementation(async () => structuredClone(row));
  h.signToken.mockReturnValue({ token: 'fictional-token', expiresInSec: 300 });
});
describe('Scribe consent mode boundaries through real API handlers', () => {
  it.each(['DICTATE', 'UPLOAD'])(
    'preserves an explicit ambient refusal when acknowledging %s',
    async (mode) => {
      expect((await decline(req({}, 'DELETE'), ctx)).status).toBe(200);
      expect((await acknowledge(mode)).status).toBe(200);
      expect(row.consentSnapshot).toMatchObject({
        captureMode: mode,
        ambientCaptureDeclined: true,
        notes: expect.stringContaining('Patient declined live ambient capture'),
      });
      expect((await token(req(), ctx)).status).toBe(409);
      expect(h.signToken).not.toHaveBeenCalled();
    },
  );
  it('allows only a separate explicit live acknowledgement to replace an ambient refusal', async () => {
    row.consentSnapshot = refused();
    expect((await acknowledge('LIVE')).status).toBe(200);
    expect(row.consentSnapshot).toMatchObject({
      captureMode: 'LIVE',
      ambientCaptureDeclined: false,
    });
    expect((await token(req(), ctx)).status).toBe(200);
    expect(row.status).toBe('SCHEDULED');
    expect(h.signToken).toHaveBeenCalledOnce();
  });
  it('reads a newer refusal after acquiring the consent lock instead of overwriting it from a stale pre-lock read', async () => {
    h.lock.mockImplementationOnce(async () => {
      row.consentSnapshot = refused();
      return [{ id: 'fictional-client' }];
    });
    expect((await acknowledge('DICTATE')).status).toBe(200);
    expect(row.consentSnapshot).toMatchObject({
      captureMode: 'DICTATE',
      ambientCaptureDeclined: true,
    });
  });
  it('does not erase a mode-specific Scribe acknowledgement through a mode-less legacy POST', async () => {
    row.consentSnapshot = complete({ captureMode: 'DICTATE' });
    expect((await acknowledge()).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
    expect(row.consentSnapshot).toMatchObject({ captureMode: 'DICTATE' });
  });
  it('retains legacy Mind consent acknowledgement without a mode', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'owner', user: { vertical: 'THERAPIST' } },
    });
    row.psychologist = { vertical: 'THERAPIST' };
    expect((await acknowledge()).status).toBe(200);
    expect(row.consentSnapshot).not.toHaveProperty('captureMode');
  });
  it.each(['LIVE', 'UPLOAD'])('does not start %s using a DICTATE acknowledgement', async (mode) => {
    row.consentSnapshot = complete({ captureMode: 'DICTATE', ambientCaptureDeclined: true });
    expect((await start(req({ captureMode: mode }), ctx)).status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });
  it.each([undefined, 'invalid'])(
    'requires an explicit valid Scribe start mode (%s)',
    async (mode) => {
      row.consentSnapshot = complete({ captureMode: 'DICTATE' });
      expect((await start(req(mode ? { captureMode: mode } : {}), ctx)).status).toBe(400);
      expect(h.update).not.toHaveBeenCalled();
    },
  );
  it('starts acknowledged dictation while preserving ambient refusal', async () => {
    row.consentSnapshot = complete({ captureMode: 'DICTATE', ambientCaptureDeclined: true });
    expect((await start(req({ captureMode: 'DICTATE' }), ctx)).status).toBe(200);
    expect(row).toMatchObject({
      status: 'IN_PROGRESS',
      captureMode: 'DICTATE',
      consentSnapshot: { ambientCaptureDeclined: true },
    });
  });
  it('preserves Mind batch start without a capture-mode body', async () => {
    h.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'owner', user: { vertical: 'THERAPIST' } },
    });
    row.psychologist = { vertical: 'THERAPIST' };
    row.consentSnapshot = complete();
    expect((await start(req(), ctx)).status).toBe(200);
    expect(row.status).toBe('IN_PROGRESS');
    expect(row.captureMode).toBe(null);
  });
  it.each(['DICTATE', 'UPLOAD'])(
    'does not issue a live token for an already active %s session',
    async (mode) => {
      row.status = 'IN_PROGRESS';
      row.captureMode = mode;
      row.consentSnapshot = complete();
      expect((await token(req(), ctx)).status).toBe(409);
      expect(h.signToken).not.toHaveBeenCalled();
    },
  );
});
