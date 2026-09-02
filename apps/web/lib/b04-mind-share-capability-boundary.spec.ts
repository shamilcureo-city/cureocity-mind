import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  parseJson: vi.fn(),
  sessionFindFirst: vi.fn(),
  clientFindUnique: vi.fn(),
  transaction: vi.fn(),
  buildSnapshot: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requireCapability: mocks.requireCapability }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findFirst: mocks.sessionFindFirst },
    client: { findUnique: mocks.clientFindUnique },
    exerciseAssignment: { findFirst: vi.fn() },
    treatmentPlan: { findFirst: vi.fn() },
    patientShare: { findMany: vi.fn(async () => []) },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./share-channels', () => ({ shareChannels: vi.fn() }));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: mocks.buildSnapshot,
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({ resolveClientPii: vi.fn() }));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(async () => null),
  encryptForTenant: vi.fn(async () => 'encrypted'),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => null),
  encryptShareRecipientEnvelope: vi.fn(async () => 'encrypted-recipient'),
}));
vi.mock('./share-dispatch-safety', () => ({
  lockClientShareDispatch: vi.fn(),
  readWinningShareDispatch: vi.fn(),
  finalizeLeasedShare: vi.fn(),
}));

import { POST as share } from '../app/api/v1/share/route';
import { GET as mindShareOptions } from '../app/api/v1/sessions/[id]/mind-share-options/route';
import { PUT as patientTakeaway } from '../app/api/v1/sessions/[id]/patient-takeaway/route';

const capabilityDenied = () =>
  NextResponse.json(
    { error: 'This account is not authorized for the requested clinical capability' },
    { status: 403 },
  );

function request(path: string, method: 'GET' | 'POST' | 'PUT', body?: unknown) {
  return new Request(`https://example.test${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}

function grantPatientSharingOnly(vertical: 'THERAPIST' | 'DOCTOR') {
  mocks.requireCapability.mockImplementation(async (_req, capability: string) =>
    capability === 'BEHAVIORAL_HEALTH_DOCUMENTATION'
      ? { ok: false, response: capabilityDenied() }
      : {
          ok: true,
          value: {
            psychologistId: 'psy-1',
            user: { vertical, capabilities: ['PATIENT_SHARING'] },
          },
        },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionFindFirst.mockResolvedValue(null);
  mocks.clientFindUnique.mockResolvedValue(null);
  mocks.transaction.mockResolvedValue(false);
});

describe('B04 Mind share capability boundary', () => {
  it.each([
    [
      'mind share options',
      () =>
        mindShareOptions(request('/api/v1/sessions/session-1/mind-share-options', 'GET'), {
          params: Promise.resolve({ id: 'session-1' }),
        }),
    ],
    [
      'patient takeaway',
      () =>
        patientTakeaway(
          request('/api/v1/sessions/session-1/patient-takeaway', 'PUT', { summary: 'Keep going' }),
          { params: Promise.resolve({ id: 'session-1' }) },
        ),
    ],
  ])('denies a therapist without behavioral-health documentation at %s', async (_name, call) => {
    grantPatientSharingOnly('THERAPIST');
    mocks.parseJson.mockResolvedValue({ ok: true, value: { summary: 'Keep going' } });

    const response = await call();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'This account is not authorized for the requested clinical capability',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
      expect.anything(),
    );
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['HOMEWORK', 'SESSION_TAKEAWAY'] as const)(
    'denies a doctor sharing the Mind-only %s artefact before any client read',
    async (artefactType) => {
      grantPatientSharingOnly('DOCTOR');
      mocks.parseJson.mockResolvedValue({
        ok: true,
        value: {
          clientId: 'client-1',
          channels: ['PORTAL_LINK'],
          artefact:
            artefactType === 'HOMEWORK'
              ? { artefactType, assignmentId: 'assignment-1' }
              : { artefactType, sessionId: 'session-1' },
        },
      });

      const response = await share(request('/api/v1/share', 'POST', {}));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: 'This account is not authorized for the requested clinical capability',
      });
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(mocks.requireCapability).toHaveBeenCalledWith(
        expect.anything(),
        'BEHAVIORAL_HEALTH_DOCUMENTATION',
        expect.anything(),
      );
      expect(mocks.clientFindUnique).not.toHaveBeenCalled();
      expect(mocks.buildSnapshot).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['AFTER_VISIT_SUMMARY', { artefactType: 'AFTER_VISIT_SUMMARY', sessionId: 'session-1' }],
    ['CHRONIC_PROGRESS_REPORT', { artefactType: 'CHRONIC_PROGRESS_REPORT', clientId: 'client-1' }],
    ['RX_PAD', { artefactType: 'RX_PAD', sessionId: 'session-1' }],
  ] as const)(
    'uses the medical, not Mind, documentation gate on doctor %s shares',
    async (_type, artefact) => {
      grantPatientSharingOnly('DOCTOR');
      mocks.parseJson.mockResolvedValue({
        ok: true,
        value: { clientId: 'client-1', channels: ['PORTAL_LINK'], artefact },
      });

      const response = await share(request('/api/v1/share', 'POST', {}));

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Client not found' });
      expect(mocks.requireCapability.mock.calls.map((call) => call[1])).toEqual([
        'PATIENT_SHARING',
        'MEDICAL_DOCUMENTATION',
      ]);
      expect(mocks.clientFindUnique).toHaveBeenCalledTimes(1);
    },
  );
});
