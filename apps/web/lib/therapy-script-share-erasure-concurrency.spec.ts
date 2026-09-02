import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  buildSnapshot: vi.fn(),
  lockedClient: [] as Array<{
    id: string;
    psychologistId: string;
    deletedAt: Date | null;
    status: 'ACTIVE' | 'PAUSED';
  }>,
  queryRaw: vi.fn(),
  assignmentFindFirst: vi.fn(),
  assignmentCreate: vi.fn(),
  patientShareCreate: vi.fn(),
  writeAudit: vi.fn(),
  sendWhatsApp: vi.fn(),
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
  decryptForTenant: vi.fn(async () => JSON.stringify({ version: 1, value: null })),
  encryptForTenant: vi.fn(async () => 'encrypted-message'),
}));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(async () => ({
    destination: null,
    clientFirstName: 'Client',
  })),
  encryptShareRecipientEnvelope: vi.fn(async () => 'encrypted-recipient'),
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://mind.example') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({
    whatsappReady: true,
    emailReady: true,
    messaging: { sendWhatsApp: mocks.sendWhatsApp },
  })),
}));
vi.mock('./prisma', () => {
  const exerciseAssignment = {
    findFirst: mocks.assignmentFindFirst,
    create: mocks.assignmentCreate,
  };
  const patientShare = {
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    create: mocks.patientShareCreate,
    findUnique: vi.fn(async () => ({
      id: 'share-1',
      psychologistId: 'psy-1',
      channel: 'PORTAL_LINK',
      status: 'PENDING',
      shareToken: 'token-1',
      errorCode: null,
      recipientEnvelopeEncrypted: 'encrypted-recipient',
      therapistMessageEncrypted: 'encrypted-message',
      subject: 'Therapy script',
      snapshot: { kind: 'THERAPY_SCRIPT' },
      language: 'en',
    })),
    findUniqueOrThrow: vi.fn(async () => ({
      id: 'share-1',
      status: 'PENDING',
      shareToken: 'token-1',
      errorCode: null,
    })),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: mocks.queryRaw,
    client: { findFirst: vi.fn(async () => null) },
    exerciseAssignment,
    patientShare,
    shareRateReservation: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
  };
  return {
    prisma: {
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
      patientShare,
      $transaction: vi.fn((work: (value: typeof tx) => unknown) => work(tx)),
    },
  };
});

import { POST } from '../app/api/v1/share/route';

function request() {
  return new Request('https://mind.example/api/v1/share', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: '{}',
  }) as never;
}

function lockedClientSql(): string {
  const call = mocks.queryRaw.mock.calls[0]?.[0] as TemplateStringsArray | undefined;
  return call ? Array.from(call).join('?') : '';
}

async function expectLifecycleLossWithoutEffects(response: Response): Promise<void> {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: 'Client not found' });
  expect(mocks.assignmentCreate).not.toHaveBeenCalled();
  expect(mocks.writeAudit).not.toHaveBeenCalled();
  expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  expect(mocks.sendWhatsApp).not.toHaveBeenCalled();
  expect(lockedClientSql()).toContain('FROM "clients"');
  expect(lockedClientSql()).toContain('FOR UPDATE');
}

describe('therapy-script share client lifecycle concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockedClient = [];
    mocks.queryRaw.mockImplementation(async () => mocks.lockedClient);
    mocks.assignmentFindFirst.mockResolvedValue(null);
    mocks.assignmentCreate.mockResolvedValue({ id: 'assignment-1' });
    mocks.patientShareCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'share-1',
      status: 'PENDING',
      shareToken: 'token-1',
      errorCode: null,
    }));
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: {
        clientId: 'client-1',
        channels: ['PORTAL_LINK'],
        idempotencyKey: 'therapy-script-erasure-race',
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
        homework: { description: 'Practise the private exercise' },
      },
      subject: 'Therapy script',
      sessionId: 'session-1',
    });
  });

  it('leaves no assignment, audit, share, or dispatch side effects when erasure wins the race', async () => {
    let finishErasure!: () => void;
    mocks.queryRaw.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishErasure = () => resolve([]);
        }),
    );

    const responsePromise = POST(request());
    await vi.waitFor(() => expect(mocks.queryRaw).toHaveBeenCalledTimes(1));
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();

    finishErasure();
    const response = await responsePromise;

    await expectLifecycleLossWithoutEffects(response);
  });

  it('leaves no assignment, audit, share, or dispatch side effects after deactivation wins', async () => {
    mocks.lockedClient = [
      { id: 'client-1', psychologistId: 'psy-1', deletedAt: null, status: 'PAUSED' },
    ];

    const response = await POST(request());

    await expectLifecycleLossWithoutEffects(response);
  });

  it('persists active-client homework and its audit before the durable portal share', async () => {
    mocks.lockedClient = [
      { id: 'client-1', psychologistId: 'psy-1', deletedAt: null, status: 'ACTIVE' },
    ];

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.assignmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: 'client-1',
        psychologistId: 'psy-1',
        source: 'THERAPY_SCRIPT',
        sourceTherapyScriptId: 'script-1',
        customDescription: 'Practise the private exercise',
      }),
      select: { id: true },
    });
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXERCISE_ASSIGNED', targetId: 'assignment-1' }),
      expect.anything(),
    );
    expect(mocks.patientShareCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        artefactType: 'THERAPY_SCRIPT',
        snapshot: expect.objectContaining({ homeworkAssignmentId: 'assignment-1' }),
      }),
    });
    expect(mocks.writeAudit.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.patientShareCreate.mock.invocationCallOrder[0]!,
    );
  });

  it('reuses the open therapy-script assignment idempotently without a second assignment audit', async () => {
    mocks.lockedClient = [
      { id: 'client-1', psychologistId: 'psy-1', deletedAt: null, status: 'ACTIVE' },
    ];
    mocks.assignmentFindFirst.mockResolvedValue({ id: 'assignment-existing' });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.assignmentCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'EXERCISE_ASSIGNED' }),
      expect.anything(),
    );
    expect(mocks.patientShareCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshot: expect.objectContaining({ homeworkAssignmentId: 'assignment-existing' }),
      }),
    });
  });
});
