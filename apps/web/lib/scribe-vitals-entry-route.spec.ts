import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  remove: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.auth }));
vi.mock('./prisma', () => ({
  prisma: { session: { findUnique: h.session }, $transaction: h.transaction },
}));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
import { POST } from '../app/api/v1/sessions/[id]/vitals/route';
const request = (body: unknown) =>
  POST(
    new NextRequest('https://example.test/api/v1/sessions/s1/vitals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 's1' }) },
  );
type Row = { sessionId: string; measure: string; value: number; source: string };
let rows: Row[];
beforeEach(() => {
  vi.resetAllMocks();
  rows = [{ sessionId: 's1', measure: 'BP', value: 122, source: 'MANUAL_ENTRY' }];
  h.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'p1' } });
  h.session.mockResolvedValue({
    id: 's1',
    clientId: 'c1',
    psychologistId: 'p1',
    psychologist: { vertical: 'DOCTOR' },
  });
  h.query.mockResolvedValue([{ id: 'c1', psychologistId: 'p1' }]);
  h.remove.mockImplementation(({ where }) => {
    rows = rows.filter(
      (r) =>
        !(
          r.sessionId === where.sessionId &&
          r.source === where.source &&
          where.measure.in.includes(r.measure)
        ),
    );
  });
  h.create.mockImplementation(({ data }) => {
    rows.push(...data);
  });
  h.transaction.mockImplementation((run) =>
    run({ $queryRaw: h.query, clinicalReading: { deleteMany: h.remove, createMany: h.create } }),
  );
});
describe('incremental manual vitals', () => {
  it('adding weight from a blank reopened form preserves existing BP', async () => {
    expect((await request({ bpSystolic: null, bpDiastolic: null, weightKg: 64 })).status).toBe(201);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ measure: 'BP', value: 122 }),
        expect.objectContaining({ measure: 'WEIGHT', value: 64 }),
      ]),
    );
    expect(h.remove).toHaveBeenCalledWith({
      where: { sessionId: 's1', source: 'MANUAL_ENTRY', measure: { in: ['WEIGHT'] } },
    });
  });
  it('correcting BP replaces only BP and retains previously measured weight', async () => {
    rows.push({ sessionId: 's1', measure: 'WEIGHT', value: 64, source: 'MANUAL_ENTRY' });
    expect((await request({ bpSystolic: 124, bpDiastolic: 76 })).status).toBe(201);
    expect(rows.filter((r) => r.measure === 'BP')).toEqual([
      expect.objectContaining({ value: 124 }),
    ]);
    expect(rows.find((r) => r.measure === 'WEIGHT')?.value).toBe(64);
  });
  it('refuses invalid or half-entered BP without changing prior readings', async () => {
    expect((await request({ bpSystolic: 122 })).status).toBe(400);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it('cannot resurrect measurements after erasure wins the client lock', async () => {
    h.query.mockResolvedValue([]);
    expect((await request({ weightKg: 64 })).status).toBe(404);
    expect(h.remove).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });
});
