import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  therapistEmail: 'therapist@example.test' as string | null,
  instrumentCreate: vi.fn(),
  shareUpdate: vi.fn(),
  writeAudit: vi.fn(),
  scoreInstrument: vi.fn(),
  processCrisisAlertOutbox: vi.fn(),
  crisisCreate: vi.fn(),
  crisisUpdateMany: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  PatientShareTokenSchema: { safeParse: vi.fn((value) => ({ success: true, data: value })) },
  InstrumentCheckinSnapshotSchema: {
    safeParse: vi.fn(() => ({
      success: true,
      data: { kind: 'INSTRUMENT_CHECKIN', instrumentKey: 'PHQ9', completed: false },
    })),
  },
  ClinicalLocaleSchema: { safeParse: vi.fn(() => ({ success: true })) },
  CheckinSubmitInputSchema: {},
}));
vi.mock('@cureocity/clinical', () => ({
  INSTRUMENTS: { PHQ9: { key: 'PHQ9' } },
  InstrumentScoringError: class extends Error {},
  scoreInstrument: mocks.scoreInstrument,
}));
vi.mock('./validate', () => ({
  parseJson: vi.fn(async () => ({ ok: true, value: { responses: { q1: 0 } } })),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./crisis-alert-outbox', () => ({
  processCrisisAlertOutbox: mocks.processCrisisAlertOutbox,
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://canonical.test') }));
vi.mock('./prisma', () => {
  const currentShare = {
    snapshot: { kind: 'INSTRUMENT_CHECKIN', instrumentKey: 'PHQ9', completed: false },
    status: 'SENT',
    expiresAt: new Date(Date.now() + 60_000),
  };
  const tx = {
    $executeRaw: vi.fn(),
    patientShare: {
      findUnique: vi.fn(async () => currentShare),
      findMany: vi.fn(async () => [{ id: 'share-accepted', ...currentShare }]),
      updateMany: mocks.shareUpdate,
    },
    instrumentResponse: { create: mocks.instrumentCreate },
    crisisAlertAttempt: {
      create: mocks.crisisCreate,
      updateMany: mocks.crisisUpdateMany,
    },
  };
  return {
    prisma: {
      patientShare: {
        findUnique: vi.fn(async () => ({
          id: 'share-accepted',
          shareBatchId: 'batch-accepted',
          sessionId: 'session-next',
          clientId: 'client-1',
          psychologistId: 'psy-1',
          artefactType: 'INSTRUMENT_CHECKIN',
          snapshot: currentShare.snapshot,
          language: 'en',
          status: 'SENT',
          expiresAt: currentShare.expiresAt,
          psychologist: { email: mocks.therapistEmail, fullName: 'Therapist' },
        })),
      },
      $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { POST } from '../app/api/v1/p/[token]/checkin/route';

describe('public check-in accepted-share provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.therapistEmail = 'therapist@example.test';
    mocks.instrumentCreate.mockResolvedValue({ id: 'response-1' });
    mocks.shareUpdate.mockResolvedValue({ count: 1 });
    mocks.scoreInstrument.mockReturnValue({ score: 3, severityKey: 'minimal', riskFlagged: false });
    mocks.crisisCreate.mockResolvedValue({ id: 'alert-1' });
    mocks.crisisUpdateMany.mockResolvedValue({ count: 1 });
    mocks.processCrisisAlertOutbox.mockResolvedValue({
      sent: 1,
      failed: 0,
      unknown: 0,
      failures: [],
    });
  });

  it('durably records crisis intent before sending via the canonical public URL and finalizes receipt plus audit', async () => {
    mocks.scoreInstrument.mockReturnValue({ score: 9, severityKey: 'mild', riskFlagged: true });

    const response = await POST(
      new Request('https://forged-host.test/api/v1/p/token/checkin', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'valid-token' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.crisisCreate).toHaveBeenCalledWith({
      data: {
        instrumentResponseId: 'response-1',
        psychologistId: 'psy-1',
        clientId: 'client-1',
      },
      select: { id: true },
    });
    expect(mocks.processCrisisAlertOutbox).toHaveBeenCalledWith({ ids: ['alert-1'], limit: 1 });
    expect(
      mocks.writeAudit.mock.calls.some(([audit]) => audit.metadata?.outcome === 'intent_recorded'),
    ).toBe(true);
  });

  it('persists source session, accepted share, and logical batch on InstrumentResponse', async () => {
    const response = await POST(
      new Request('https://example.test/api/v1/p/token/checkin', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'valid-token' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.instrumentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sessionId: 'session-next',
        sourcePatientShareId: 'share-accepted',
        sourceShareBatchId: 'batch-accepted',
      }),
    });
  });

  it('creates and processes a crisis attempt when the therapist email is unavailable', async () => {
    mocks.therapistEmail = null;
    mocks.scoreInstrument.mockReturnValue({ score: 9, severityKey: 'mild', riskFlagged: true });
    mocks.processCrisisAlertOutbox.mockResolvedValue({
      sent: 0,
      failed: 1,
      unknown: 0,
      failures: ['alert-1'],
    });

    const response = await POST(
      new Request('https://example.test/api/v1/p/token/checkin', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'valid-token' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.crisisCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ instrumentResponseId: 'response-1' }),
      }),
    );
    expect(mocks.processCrisisAlertOutbox).toHaveBeenCalledWith({ ids: ['alert-1'], limit: 1 });
  });
});
