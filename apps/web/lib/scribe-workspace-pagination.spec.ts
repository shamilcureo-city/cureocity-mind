import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), decrypt: vi.fn() }));
vi.mock('./prisma', () => ({ prisma: { scribeWorkspaceRecord: { findMany: mocks.findMany } } }));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: vi.fn(), decryptForTenant: mocks.decrypt }));
vi.mock('./auth-server', () => ({ requireCapability: vi.fn() }));
vi.mock('./audit', () => ({ writeAudit: vi.fn() }));
import { listScribeRecords } from './scribe-workspace-store';

const scope = {
  psychologistId: 'doctor-1',
  kind: 'report' as const,
  clientId: 'patient-1',
  sessionId: 'visit-1',
};
const schema = z.object({ name: z.string() });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
});
describe('opt-in encrypted-record keyset pagination', () => {
  it('uses stable creation order for the first page without changing default caller order', async () => {
    await listScribeRecords({ ...scope, limit: 6, page: {} }, schema);
    expect(mocks.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 6, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    );
    await listScribeRecords(scope, schema);
    expect(mocks.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 200, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] }),
    );
  });
  it('adds cursor conditions without replacing ownership or active-patient predicates', async () => {
    const createdAt = '2026-09-25T00:00:00.000Z';
    await listScribeRecords(
      { ...scope, limit: 6, page: { after: { createdAt, id: 'report-5' } } },
      schema,
    );
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        ...scope,
        OR: [{ clientId: null }, { client: { deletedAt: null, psychologistId: 'doctor-1' } }],
        AND: [
          {
            OR: [
              { createdAt: { lt: new Date(createdAt) } },
              { createdAt: new Date(createdAt), id: { gt: 'report-5' } },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 6,
    });
  });
  it('hard-bounds opt-in pages even if an internal caller asks for more', async () => {
    await listScribeRecords({ ...scope, limit: 500, page: {} }, schema);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 11 }));
  });
  it.each([
    { id: '../record', createdAt: '2026-09-25T00:00:00.000Z' },
    { id: 'record-1', createdAt: 'not-a-date' },
  ])('rejects invalid cursor before querying or decrypting', async (after) => {
    await expect(listScribeRecords({ ...scope, page: { after } }, schema)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
});
