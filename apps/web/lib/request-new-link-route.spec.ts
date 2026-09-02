import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
  updateMany: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  PatientShareTokenSchema: { safeParse: (value: string) => ({ success: true, data: value }) },
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({}),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => {
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: mocks.queryRaw,
    patientShare: { updateMany: mocks.updateMany },
  };
  return {
    prisma: {
      patientShare: { findUnique: mocks.findUnique },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    },
  };
});

import { POST } from '../app/api/v1/p/[token]/request-new-link/route';

describe('request-new-link resend-family eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 'family-root',
      clientId: 'client-1',
      psychologistId: 'psy-1',
      status: 'SENT',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      resendOfId: null,
      psychologist: { vertical: 'THERAPIST' },
    });
    mocks.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      // Model a family whose newest row is failed while an older active row is
      // expired and eligible. The query itself must select the eligible row.
      return sql.includes(`"status" IN ('SENT', 'OPENED')`) && sql.includes('"expiresAt" <=')
        ? [{ id: 'eligible-expired', clientId: 'client-1', psychologistId: 'psy-1' }]
        : [{ id: 'newest-failed', clientId: 'client-1', psychologistId: 'psy-1' }];
    });
    mocks.updateMany.mockImplementation(async ({ where }: { where: { id: string } }) => ({
      count: where.id === 'eligible-expired' ? 1 : 0,
    }));
  });

  it('records the refresh request on the newest active expired descendant rather than a newer failed row', async () => {
    const response = await POST(
      new Request('https://mind.cureocity.in/api/v1/p/token/request-new-link', {
        method: 'POST',
      }) as never,
      { params: Promise.resolve({ token: 'token' }) },
    );

    expect(response.status).toBe(202);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'eligible-expired' }) }),
    );
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'eligible-expired' }),
      expect.anything(),
    );
  });
});
