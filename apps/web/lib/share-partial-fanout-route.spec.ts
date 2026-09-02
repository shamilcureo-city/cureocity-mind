import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  sendEmail: vi.fn(),
  patientShareCreate: vi.fn(),
  patientShareUpdate: vi.fn(),
  patientShareUpdateMany: vi.fn(),
  reservationDelete: vi.fn(),
  reservationDeleteMany: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
}));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: vi.fn(),
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({
  WATERMARK_TAGLINE: '',
  watermarkUrl: vi.fn(() => 'https://example.test'),
}));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({
  resolveClientPii: vi.fn(async () => ({
    fullName: 'Changed Name',
    contactPhone: '+919000000000',
    contactEmail: 'changed@example.test',
  })),
}));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(async () => null),
  encryptForTenant: vi.fn(async () => 'encrypted'),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => null),
  encryptShareRecipientEnvelope: vi.fn(async () => 'encrypted-recipient'),
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://example.test') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({
    whatsappReady: true,
    emailReady: true,
    messaging: { sendWhatsApp: vi.fn() },
    email: { sendEmail: mocks.sendEmail },
  })),
}));
vi.mock('./prisma', () => {
  const anchor = {
    id: 'share-whatsapp',
    clientId: 'client-1',
    psychologistId: 'psy-1',
    sessionId: 'session-1',
    shareBatchId: 'batch-1',
    requestIdempotencyKey: 'idem-1',
    requestPayloadHash: '1d1ebc2ec4fb2d415899c995609a9a22740fe312e4e2222c4e2ba8748e76cc12',
    artefactType: 'SESSION_TAKEAWAY',
    artefactId: 'session-1',
    channel: 'WHATSAPP',
    status: 'SENT',
    shareToken: 'old-token',
    language: 'en',
    snapshot: { kind: 'SESSION_TAKEAWAY', summary: 'Keep practising.' },
    subject: 'Takeaway',
    toContact: '+918888888888',
    recipientEnvelope: {
      clientFirstName: 'Original',
      destinations: {
        WHATSAPP: '+918888888888',
        EMAIL: 'original@example.test',
        PORTAL_LINK: null,
      },
    },
    errorCode: null,
    dispatchStartedAt: null,
    dispatchLeaseExpiresAt: null,
    createdAt: new Date(),
  };
  const tx = {
    $executeRaw: vi.fn(),
    patientShare: {
      findMany: vi.fn(async () => [anchor]),
      count: vi.fn(async () => 1),
      update: mocks.patientShareUpdate,
    },
    shareRateReservation: {
      deleteMany: mocks.reservationDeleteMany,
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'reservation-1' })),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn((fn: (arg: typeof tx) => unknown) => fn(tx)),
      client: {
        findUnique: vi.fn(async () => ({
          id: 'client-1',
          psychologistId: 'psy-1',
          fullNameEncrypted: 'x',
          contactPhoneEncrypted: 'x',
          contactEmailEncrypted: 'x',
          preferredLanguage: 'en',
          deletedAt: null,
        })),
      },
      patientShare: {
        create: mocks.patientShareCreate,
        updateMany: mocks.patientShareUpdateMany,
      },
      shareRateReservation: { delete: mocks.reservationDelete },
    },
  };
});

import { POST } from '../app/api/v1/share/route';

describe('partial fanout replay recipient immutability', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const input = {
      clientId: 'client-1',
      channels: ['WHATSAPP', 'EMAIL'],
      idempotencyKey: 'idem-1',
      artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: 'session-1' },
    };
    mocks.parseJson.mockResolvedValue({ ok: true, value: input });

    mocks.patientShareCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'share-email',
      shareToken: 'new-token',
      errorCode: null,
    }));
    mocks.patientShareUpdateMany.mockResolvedValue({ count: 1 });
    mocks.patientShareUpdate.mockImplementation(async ({ data }) => ({
      ...mocks.patientShareCreate.mock.results[0]?.value,
      id: 'share-email',
      channel: 'EMAIL',
      status: data.status,
    }));
    mocks.sendEmail.mockResolvedValue({ outcome: 'sent', providerMessageId: 'provider-1' });
    mocks.reservationDelete.mockResolvedValue({});
  });

  it('fails closed instead of recovering a legacy partial fanout from mutable Client contact', async () => {
    const response = await POST(
      new Request('https://example.test/api/v1/share', { method: 'POST', body: '{}' }) as never,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Recipient confirmation must be renewed before this share can be sent.',
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });
});
