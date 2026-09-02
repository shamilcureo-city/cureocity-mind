import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  sendViaChannel: vi.fn(),
  update: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  executeRaw: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  count: vi.fn(),
  reservationFindMany: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./client-pii', () => ({
  resolveClientPii: vi.fn(async () => ({
    fullName: 'Patient One',
    contactPhone: '+911****7890',
    contactEmail: null,
  })),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => ({
    version: 1,
    channel: 'WHATSAPP',
    destination: '+919999999999',
    clientFirstName: 'Original',
  })),
}));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(async () => JSON.stringify({ version: 1, value: 'Frozen message' })),
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({ whatsappReady: true, emailReady: true })),
}));
vi.mock('./sprint5-final-behavior', () => ({
  canOrdinarilyResend: vi.fn(
    (row) => row.status.endsWith('FAILURE') && row.errorCode !== 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
  ),
  classifyShareDelivery: vi.fn((result) => ({
    status:
      result.outcome === 'sent'
        ? 'SENT'
        : result.outcome === 'transient_failure'
          ? 'TRANSIENT_FAILURE'
          : 'PERMANENT_FAILURE',
    errorCode: result.errorCode ?? null,
  })),
  recoverExpiredDispatch: vi.fn(() => ({
    retry: false,
    status: 'TRANSIENT_FAILURE',
    errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
  })),
}));
vi.mock('../app/api/v1/share/route', () => ({ sendViaChannel: mocks.sendViaChannel }));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: mocks.executeRaw,
    patientShare: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      update: mocks.update,
      create: mocks.create,
      updateMany: mocks.updateMany,
      count: mocks.count,
    },
    shareRateReservation: { findMany: mocks.reservationFindMany },
  };
  return { prisma: { $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)) } };
});

import { POST } from '../app/api/v1/shares/[id]/resend/route';

describe('ambiguous resend recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockReset();
    mocks.findUnique.mockReset();
    mocks.update.mockReset();
    mocks.create.mockReset();
    mocks.updateMany.mockReset();
    mocks.count.mockReset();
    mocks.reservationFindMany.mockReset();
    mocks.findFirst.mockResolvedValue({
      id: 'share-source',
      psychologistId: 'psy-1',
      clientId: 'client-1',
      sessionId: 'session-1',
      shareBatchId: 'batch-1',
      status: 'TRANSIENT_FAILURE',
      errorCode: null,
      channel: 'WHATSAPP',
      artefactType: 'HOMEWORK',
      artefactId: 'assignment-1',
      language: 'en',
      snapshot: { kind: 'HOMEWORK', assignmentId: 'assignment-1' },
      subject: 'Homework',
      recipientEnvelopeEncrypted: 'encrypted-recipient',
      therapistMessageEncrypted: 'encrypted-message',
      refreshRequestedAt: null,
      expiresAt: new Date(Date.now() + 10000),
      client: { id: 'client-1', deletedAt: null },
    });
    mocks.findUnique
      .mockResolvedValueOnce({ status: 'TRANSIENT_FAILURE', client: { deletedAt: null } })
      .mockResolvedValueOnce({
        id: 'share-resend',
        updatedAt: new Date(Date.now() - 10 * 60_000),
        status: 'PENDING',
        channel: 'WHATSAPP',
        shareToken: 'token',
        errorCode: null,
      });
    mocks.update.mockResolvedValue({
      id: 'share-resend',
      status: 'TRANSIENT_FAILURE',
      channel: 'WHATSAPP',
      shareToken: 'token',
      errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
    });
  });

  it('rejects an ordinary resend of an ambiguous provider delivery', async () => {
    mocks.findFirst.mockResolvedValueOnce({
      ...(await mocks.findFirst()),
      errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
    });

    const response = await POST(
      new Request('https://example.test/api/v1/shares/share-source/resend', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'share-source' }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.sendViaChannel).not.toHaveBeenCalled();
  });

  it('replays the encrypted immutable recipient and message and copies both to the descendant', async () => {
    const source = await mocks.findFirst();
    mocks.findFirst.mockResolvedValue({
      ...source,
      status: 'PERMANENT_FAILURE',
      errorCode: 'BOUNCE',
    });
    mocks.findUnique.mockReset();
    mocks.findUnique
      .mockResolvedValueOnce({ status: 'PERMANENT_FAILURE', client: { deletedAt: null } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'share-resend-new',
        clientId: 'client-1',
        channel: 'WHATSAPP',
        status: 'SENT',
        shareToken: 'new-token',
      });
    mocks.reservationFindMany.mockResolvedValue([]);
    mocks.count.mockResolvedValue(0);
    mocks.create.mockImplementation(async ({ data }) => ({ ...data, id: 'share-resend-new' }));
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.sendViaChannel.mockResolvedValue({ outcome: 'sent', providerMessageId: 'provider-1' });

    const response = await POST(
      new Request('https://example.test/api/v1/shares/share-source/resend', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'share-source' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        toContact: null,
        recipientEnvelopeEncrypted: 'encrypted-recipient',
        therapistMessageEncrypted: 'encrypted-message',
      }),
    });
    expect(mocks.sendViaChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        toContact: '+919999999999',
        clientFirstName: 'Original',
        therapistMessage: 'Frozen message',
      }),
    );
  });

  it('atomically terminalizes the receipt with its audit and never repeats the provider call', async () => {
    const response = await POST(
      new Request('https://example.test/api/v1/shares/share-source/resend', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ id: 'share-source' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'share-resend' },
      data: {
        status: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
        dispatchLeaseExpiresAt: null,
      },
    });
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1);
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({
      actorType: 'SYSTEM',
      action: 'PATIENT_ARTEFACT_SHARED',
      targetType: 'PatientShare',
      targetId: 'share-resend',
      metadata: {
        clientId: 'client-1',
        resentFromShareId: 'share-source',
        channel: 'WHATSAPP',
        outcome: 'TRANSIENT_FAILURE',
        errorCode: 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
      },
    });
    expect(mocks.writeAudit.mock.calls[0]?.[1]).toMatchObject({ patientShare: expect.any(Object) });
    expect(mocks.sendViaChannel).not.toHaveBeenCalled();
  });
});
