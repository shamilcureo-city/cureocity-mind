import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  buildSnapshot: vi.fn(),
  writeAudit: vi.fn(),
  assignmentCreate: vi.fn(),
  patientShareCreate: vi.fn(),
}));

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
}));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: vi.fn(() => ({})),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: mocks.buildSnapshot,
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({
  resolveClientPii: vi.fn(async () => ({
    fullName: 'Client',
    contactPhone: null,
    contactEmail: null,
  })),
}));
vi.mock('./tenant-crypto', () => ({
  decryptForTenant: vi.fn(),
  encryptForTenant: vi.fn(async () => 'encrypted-message'),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(),
  encryptShareRecipientEnvelope: vi.fn(async () => 'encrypted-recipient'),
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://mind.example') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({ whatsappReady: false, emailReady: false })),
}));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: vi.fn(),
    patientShare: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 30),
      create: mocks.patientShareCreate,
    },
    exerciseAssignment: {
      findFirst: vi.fn(async () => null),
      create: mocks.assignmentCreate,
    },
    shareRateReservation: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn((work: (value: typeof tx) => unknown) => work(tx)),
      client: {
        findUnique: vi.fn(async () => ({
          id: 'client-1',
          psychologistId: 'psy-1',
          fullNameEncrypted: 'encrypted',
          contactPhoneEncrypted: null,
          contactEmailEncrypted: null,
          preferredLanguage: 'en',
          deletedAt: null,
        })),
      },
      patientShare: { create: mocks.patientShareCreate },
    },
  };
});

import { POST } from '../app/api/v1/share/route';
import { parseSharesPerHourCap } from './share-rate-cap';

describe('share rate rejection atomicity', () => {
  it('accepts only safe non-negative integer caps and safely defaults invalid configuration', () => {
    expect(parseSharesPerHourCap(undefined)).toBe(30);
    expect(parseSharesPerHourCap('')).toBe(30);
    expect(parseSharesPerHourCap('0')).toBe(0);
    expect(parseSharesPerHourCap('12')).toBe(12);
    expect(parseSharesPerHourCap('12.9')).toBe(30);
    for (const invalid of ['-1', 'NaN', 'Infinity', '-Infinity', 'not-a-number']) {
      expect(parseSharesPerHourCap(invalid)).toBe(30);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: {
        clientId: 'client-1',
        channels: ['PORTAL_LINK'],
        idempotencyKey: 'rate-rejected-batch',
        artefact: {
          artefactType: 'THERAPY_SCRIPT',
          therapyScriptId: 'script-1',
          assignHomework: true,
        },
      },
    });
    mocks.buildSnapshot.mockResolvedValue({
      snapshot: {
        kind: 'THERAPY_SCRIPT',
        homework: { description: 'Practise paced breathing' },
      },
      subject: 'Therapy script',
      sessionId: 'session-1',
    });
    mocks.assignmentCreate.mockResolvedValue({ id: 'assignment-1' });
  });

  it('creates no homework assignment, patient share, or audit when capacity is rejected', async () => {
    const response = await POST(
      new Request('https://mind.example/api/v1/share', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: '{}',
      }) as never,
    );

    expect(response.status).toBe(429);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });
});
