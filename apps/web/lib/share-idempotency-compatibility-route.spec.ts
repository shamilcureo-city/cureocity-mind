import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  parseJson: vi.fn(),
  clientFindUnique: vi.fn(),
  transaction: vi.fn(),
  executeRawValues: [] as unknown[][],
  existingRows: [] as Array<{
    requestPayloadHash: string;
    status: string;
    channel: string;
  }>,
}));

vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () => ({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  })),
}));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: vi.fn(() => ({})), writeAudit: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.clientFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('./share-snapshots', () => ({
  buildSnapshot: vi.fn(),
  SnapshotBuildError: class extends Error {},
}));
vi.mock('./share-channels', () => ({ shareChannels: vi.fn() }));
vi.mock('./share-translate', () => ({ translateForShare: vi.fn() }));
vi.mock('./watermark', () => ({ WATERMARK_TAGLINE: '', watermarkUrl: vi.fn() }));
vi.mock('./clinical-mappers', () => ({ toPatientShare: vi.fn() }));
vi.mock('./client-pii', () => ({ resolveClientPii: vi.fn() }));
vi.mock('./appointment-links', () => ({ publicBaseUrl: vi.fn(() => 'https://mind.example') }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: vi.fn(), encryptForTenant: vi.fn() }));
vi.mock('./share-recipient-envelope', () => ({
  decryptShareRecipientEnvelope: vi.fn(),
  encryptShareRecipientEnvelope: vi.fn(),
}));
vi.mock('./share-dispatch-safety', () => ({
  finalizeLeasedShare: vi.fn(),
  lockClientShareDispatch: vi.fn(),
  readWinningShareDispatch: vi.fn(),
}));

import { POST } from '../app/api/v1/share/route';

const explicitKey = '123e4567-e89b-42d3-a456-426614174000';
const baseInput = {
  clientId: 'client-1',
  channels: ['PORTAL_LINK'],
  artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: 'session-1' },
};

function request(): never {
  return new Request('https://mind.example/api/v1/share', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: '{}',
  }) as never;
}

function capturedRequestKey(call: number): string {
  const lockIdentity = mocks.executeRawValues[call]?.[0];
  expect(lockIdentity).toEqual(expect.any(String));
  return (lockIdentity as string).slice('psy-1:'.length);
}

function payloadHash(input: typeof baseInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        clientId: input.clientId,
        channels: input.channels,
        therapistMessage: null,
        language: null,
        artefact: input.artefact,
      }),
    )
    .digest('hex');
}

describe('legacy share idempotency compatibility at the authenticated route boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRawValues = [];
    mocks.existingRows = [];
    mocks.clientFindUnique.mockResolvedValue(null);
    mocks.parseJson.mockResolvedValue({ ok: true, value: baseInput });
    mocks.transaction.mockImplementation(async (work) => {
      const tx = {
        $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
          mocks.executeRawValues.push(values);
          return Promise.resolve(0);
        },
        patientShare: {
          findMany: vi.fn(async () => mocks.existingRows),
          delete: vi.fn(),
        },
      };
      return work(tx);
    });
  });

  it('assigns a fresh UUID to each accepted legacy delivery instead of deduping unrelated sends', async () => {
    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
    const firstKey = capturedRequestKey(0);
    const secondKey = capturedRequestKey(1);
    expect(firstKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(secondKey).not.toBe(firstKey);
  });

  it('preserves an explicit client UUID exactly for replay lookup', async () => {
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: { ...baseInput, idempotencyKey: explicitKey },
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(capturedRequestKey(0)).toBe(explicitKey);
  });

  it('rejects an explicit-key payload collision before reading the client', async () => {
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: { ...baseInput, idempotencyKey: explicitKey },
    });
    mocks.existingRows = [
      { requestPayloadHash: 'different-payload-hash', status: 'SENT', channel: 'PORTAL_LINK' },
    ];

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Idempotency key was already used for another payload.',
    });
    expect(mocks.clientFindUnique).not.toHaveBeenCalled();
    expect(capturedRequestKey(0)).toBe(explicitKey);
  });

  it('allows an exact explicit-key replay to continue without a collision response', async () => {
    mocks.parseJson.mockResolvedValue({
      ok: true,
      value: { ...baseInput, idempotencyKey: explicitKey },
    });
    mocks.existingRows = [
      {
        requestPayloadHash: payloadHash(baseInput),
        status: 'SENT',
        channel: 'PORTAL_LINK',
      },
    ];

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.clientFindUnique).toHaveBeenCalledTimes(1);
    expect(capturedRequestKey(0)).toBe(explicitKey);
  });

  it('keeps preview side-effect free and does not reserve an idempotency identity', async () => {
    mocks.parseJson.mockResolvedValue({ ok: true, value: { ...baseInput, preview: true } });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.executeRawValues).toEqual([]);
  });
});
