import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  parseJson: vi.fn(),
  eraseClientPhi: vi.fn(),
  writeAudit: vi.fn(),
  queryRaw: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.requirePsychologistId }));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./dpdp-erasure', () => ({
  eraseClientPhi: mocks.eraseClientPhi,
  ShareSubmissionInProgressError: class ShareSubmissionInProgressError extends Error {},
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-1' }),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma-migration', () => ({
  getMigrationPrisma: () => ({ $transaction: mocks.transaction }),
}));

import { PATCH } from '../app/api/v1/admin/erasure/[id]/route';

const tx = {
  $queryRaw: mocks.queryRaw,
  clientErasureRequest: { updateMany: mocks.updateMany },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1' },
  });
  mocks.queryRaw.mockResolvedValue([
    {
      id: 'erasure-1',
      status: 'PENDING',
      clientId: 'client-1',
      psychologistId: 'psy-1',
    },
  ]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.eraseClientPhi.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) =>
    callback(tx),
  );
});

const request = () => new Request('https://example.test/api/v1/admin/erasure/erasure-1') as never;
const params = { params: Promise.resolve({ id: 'erasure-1' }) };

describe('DPDP erasure audit transaction semantics', () => {
  it('records approval without claiming that erasure was fulfilled', async () => {
    mocks.parseJson.mockResolvedValue({ ok: true, value: { status: 'APPROVED' } });

    const response = await PATCH(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.eraseClientPhi).not.toHaveBeenCalled();
    expect(mocks.writeAudit).toHaveBeenCalledOnce();
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({ action: 'DSR_ERASURE_APPROVED' });
  });

  it('emits no fulfilled audit when PHI erasure fails', async () => {
    mocks.parseJson.mockResolvedValue({ ok: true, value: { status: 'FULFILLED' } });
    mocks.eraseClientPhi.mockRejectedValue(new Error('redaction failed'));

    await expect(PATCH(request(), params)).rejects.toThrow('redaction failed');

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('emits fulfilled only after erasure and the successful state transition', async () => {
    mocks.parseJson.mockResolvedValue({ ok: true, value: { status: 'FULFILLED' } });

    const response = await PATCH(request(), params);

    expect(response.status).toBe(200);
    expect(mocks.eraseClientPhi).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledOnce();
    expect(mocks.writeAudit.mock.calls.map(([entry]) => entry.action)).toEqual([
      'CLIENT_SOFT_DELETED',
      'DSR_ERASURE_FULFILLED',
    ]);
    expect(mocks.writeAudit.mock.invocationCallOrder.at(-1)).toBeGreaterThan(
      mocks.updateMany.mock.invocationCallOrder[0]!,
    );
  });
});
