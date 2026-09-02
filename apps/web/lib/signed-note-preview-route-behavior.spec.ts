import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  now: new Date('2026-09-01T12:00:00.000Z'),
  note: {} as Record<string, unknown>,
  sealed: new Map<string, string>(),
  sealCounter: 0,
}));

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  buildSnapshot: vi.fn(),
  translateForShare: vi.fn(),
  patientShareCreate: vi.fn(),
  queryRaw: vi.fn(),
  encryptForTenant: vi.fn(async (_tenant: string, plaintext: string) => {
    const token = `sealed-${++state.sealCounter}`;
    state.sealed.set(token, plaintext);
    return token;
  }),
  decryptForTenant: vi.fn(
    async (_tenant: string, token: string) => state.sealed.get(token) ?? null,
  ),
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
  buildSnapshot: mocks.buildSnapshot,
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-translate', () => ({ translateForShare: mocks.translateForShare }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn(() => '') }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({
  resolveClientPii: vi.fn(async () => ({
    fullName: 'Client One',
    contactPhone: null,
    contactEmail: null,
  })),
}));
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: mocks.encryptForTenant,
  decryptForTenant: mocks.decryptForTenant,
}));
vi.mock('./share-recipient-envelope', () => ({
  encryptShareRecipientEnvelope: vi.fn(async () => 'recipient-envelope'),
  decryptShareRecipientEnvelope: vi.fn(async () => ({
    version: 1,
    channel: 'PORTAL_LINK',
    destination: null,
    clientFirstName: 'Client',
  })),
}));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://mind.example') }));
vi.mock('./share-channels', () => ({
  shareChannels: vi.fn(() => ({ whatsappReady: false, emailReady: false })),
}));
vi.mock('./share-dispatch-safety', () => ({
  lockClientShareDispatch: vi.fn(async () => undefined),
  readWinningShareDispatch: vi.fn(async (row: Record<string, unknown>) => ({
    destination: null,
    clientFirstName: 'Client',
    therapistMessage: undefined,
    subject: row.subject,
    snapshot: row.snapshot,
    language: row.language,
  })),
  finalizeLeasedShare: vi.fn(async (_tx: unknown, args: Record<string, unknown>) => ({
    id: args.rowId,
    status: args.status,
    errorCode: args.errorCode,
  })),
}));

vi.mock('./prisma', () => {
  const patientShareFindMany = vi.fn(async () => []);
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: mocks.queryRaw,
    client: { findFirst: vi.fn(async () => ({ id: 'client-1' })) },
    patientShare: {
      findMany: patientShareFindMany,
      count: vi.fn(async () => 0),
      create: mocks.patientShareCreate,
      delete: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    shareRateReservation: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'reservation-1' })),
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
      therapyNote: {
        findFirst: vi.fn(async () => state.note),
      },
      patientShare: {
        create: mocks.patientShareCreate,
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(async () => ({
          id: 'share-1',
          shareToken: 'portal-token',
          status: 'PENDING',
          errorCode: null,
          subject: 'Session note',
          snapshot: { kind: 'SIGNED_NOTE' },
          language: 'en',
          dispatchLeaseVersion: 1,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
});

import { POST } from '../app/api/v1/share/route';

const signedNoteSnapshot = {
  kind: 'SIGNED_NOTE' as const,
  subjective: 'Original subjective',
  objective: 'Original objective',
  assessment: 'Original assessment',
  plan: 'Original plan',
  pdfUrl: null,
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 'client-1',
    channels: ['PORTAL_LINK'],
    language: 'en',
    artefact: { artefactType: 'SIGNED_NOTE', sessionId: 'session-1' },
    ...overrides,
  };
}

async function callShare(value: Record<string, unknown>) {
  mocks.parseJson.mockResolvedValueOnce({ ok: true, value });
  return POST(
    new Request('https://mind.example/api/v1/share', {
      method: 'POST',
      headers: { authorization: 'Bearer trusted-server', 'content-type': 'application/json' },
      body: '{}',
    }) as never,
  );
}

async function preview(language: 'en' | 'hi' = 'en') {
  const response = await callShare(input({ language, preview: true }));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    previewConfirmation: string;
    snapshot: typeof signedNoteSnapshot;
  }>;
}

async function confirm(token: string, overrides: Record<string, unknown> = {}) {
  return callShare(
    input({
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      previewConfirmation: token,
      ...overrides,
    }),
  );
}

function resetSignedVersion() {
  state.note = {
    id: 'therapy-note-1',
    sessionId: 'session-1',
    locked: true,
    version: 'V1',
    content: { version: 'V1', ...signedNoteSnapshot },
    rxPad: null,
    signedAt: new Date('2026-09-01T11:00:00.000Z'),
    signedBy: 'psy-1',
    signChallengeHashHex: 'a'.repeat(64),
    signSignatureB64u: 'signature-one',
  };
}

describe('signed-note preview confirmation boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(state.now);
    vi.clearAllMocks();
    state.sealed.clear();
    state.sealCounter = 0;
    resetSignedVersion();
    mocks.queryRaw.mockImplementation(async () => [state.note]);
    mocks.buildSnapshot.mockResolvedValue({
      snapshot: structuredClone(signedNoteSnapshot),
      subject: 'Session note',
      sessionId: 'session-1',
    });
    mocks.translateForShare.mockImplementation(async (values: string[]) =>
      values.map((value) => `हिन्दी:${value}`),
    );
    mocks.patientShareCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: 'share-1',
      shareToken: 'portal-token',
      status: 'PENDING',
      errorCode: null,
      dispatchLeaseVersion: 0,
    }));
  });

  it('requires preview confirmation for an English signed note', async () => {
    const response = await confirm('');

    expect(response.status).toBe(409);
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });

  it('binds confirmation to the therapy note and current signed version with a short expiry', async () => {
    const reviewed = await preview('en');
    const envelope = JSON.parse(state.sealed.get(reviewed.previewConfirmation) ?? '{}');

    expect(envelope).toMatchObject({
      version: 2,
      therapyNoteId: 'therapy-note-1',
      sessionId: 'session-1',
      issuedAt: '2026-09-01T12:00:00.000Z',
    });
    expect(envelope.signedVersionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      new Date(envelope.expiresAt).getTime() - new Date(envelope.issuedAt).getTime(),
    ).toBeLessThanOrEqual(5 * 60_000);
  });

  it('rejects a preview assembled across a concurrent re-sign boundary', async () => {
    mocks.buildSnapshot.mockImplementationOnce(async () => {
      const oldSnapshot = structuredClone(signedNoteSnapshot);
      state.note = {
        ...state.note,
        content: { version: 'V1', ...signedNoteSnapshot, plan: 'Concurrent new version' },
        signedAt: new Date('2026-09-01T12:00:30.000Z'),
        signChallengeHashHex: 'c'.repeat(64),
        signSignatureB64u: 'signature-concurrent',
      };
      return { snapshot: oldSnapshot, subject: 'Session note', sessionId: 'session-1' };
    });

    const response = await callShare(input({ language: 'en', preview: true }));

    expect(response.status).toBe(409);
    expect(mocks.encryptForTenant).toHaveBeenCalledTimes(1); // therapist message only; no seal
  });

  it('rejects confirmation after the note is unlocked', async () => {
    const reviewed = await preview('en');
    state.note = { ...state.note, locked: false };

    const response = await confirm(reviewed.previewConfirmation);

    expect(response.status).toBe(409);
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });

  it('rejects edit and re-sign drift of the same therapy note id', async () => {
    const reviewed = await preview('en');
    state.note = {
      ...state.note,
      content: { version: 'V1', ...signedNoteSnapshot, plan: 'Changed after re-sign' },
      signedAt: new Date('2026-09-01T12:01:00.000Z'),
      signChallengeHashHex: 'b'.repeat(64),
      signSignatureB64u: 'signature-two',
    };

    const response = await confirm(reviewed.previewConfirmation);

    expect(response.status).toBe(409);
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });

  it('rejects an expired confirmation', async () => {
    const reviewed = await preview('en');
    vi.advanceTimersByTime(5 * 60_000 + 1);

    const response = await confirm(reviewed.previewConfirmation);

    expect(response.status).toBe(409);
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });

  it('rejects artefact mismatch and confirmation tampering', async () => {
    const reviewed = await preview('en');

    const mismatch = await confirm(reviewed.previewConfirmation, {
      artefact: { artefactType: 'SIGNED_NOTE', sessionId: 'session-2' },
    });
    const tampered = await confirm(`${reviewed.previewConfirmation}-tampered`);

    expect(mismatch.status).toBe(409);
    expect(tampered.status).toBe(409);
    expect(mocks.patientShareCreate).not.toHaveBeenCalled();
  });

  it('sends the exact reviewed translated snapshot without retranslating', async () => {
    const reviewed = await preview('hi');
    expect(reviewed.snapshot.plan).toBe('हिन्दी:Original plan');
    expect(mocks.translateForShare).toHaveBeenCalledTimes(1);

    const response = await confirm(reviewed.previewConfirmation, { language: 'hi' });

    expect(response.status).toBe(200);
    expect(mocks.translateForShare).toHaveBeenCalledTimes(1);
    expect(mocks.patientShareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ snapshot: reviewed.snapshot }),
      }),
    );
  });

  it('preserves the exact reviewed translated signed-intake snapshot too', async () => {
    const intakeSnapshot = {
      kind: 'SIGNED_INTAKE_NOTE' as const,
      sections: [{ title: 'What you shared', body: 'Trouble sleeping' }],
      pdfUrl: null,
    };
    mocks.buildSnapshot.mockResolvedValueOnce({
      snapshot: structuredClone(intakeSnapshot),
      subject: 'Intake note',
      sessionId: 'session-1',
    });
    const previewResponse = await callShare(
      input({
        language: 'hi',
        preview: true,
        artefact: { artefactType: 'SIGNED_INTAKE_NOTE', sessionId: 'session-1' },
      }),
    );
    const reviewed = (await previewResponse.json()) as {
      previewConfirmation: string;
      snapshot: typeof intakeSnapshot;
    };
    expect(reviewed.snapshot.sections[0]).toEqual({
      title: 'हिन्दी:What you shared',
      body: 'हिन्दी:Trouble sleeping',
    });

    const response = await callShare(
      input({
        language: 'hi',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        previewConfirmation: reviewed.previewConfirmation,
        artefact: { artefactType: 'SIGNED_INTAKE_NOTE', sessionId: 'session-1' },
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.translateForShare).toHaveBeenCalledTimes(1);
    expect(mocks.patientShareCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ snapshot: reviewed.snapshot }),
      }),
    );
  });

  it('transactionally revalidates the locked signed version immediately before English share creation', async () => {
    const reviewed = await preview('en');

    const response = await confirm(reviewed.previewConfirmation);

    expect(response.status).toBe(200);
    const validationOrder = mocks.queryRaw.mock.invocationCallOrder.at(-1);
    const creationOrder = mocks.patientShareCreate.mock.invocationCallOrder[0];
    expect(validationOrder).toBeLessThan(creationOrder!);
    expect(mocks.patientShareCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ snapshot: reviewed.snapshot }) }),
    );
  });
});
