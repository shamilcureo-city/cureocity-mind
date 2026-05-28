import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdminService } from './admin.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const ADMIN_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';

function makeDeps(opts?: {
  auditRows?: Array<{
    id: string;
    actorType: string;
    actorPsychologistId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    metadata: unknown;
    createdAt: Date;
  }>;
  psyUpdate?: ReturnType<typeof vi.fn>;
}) {
  const auditLogFindMany = vi.fn().mockResolvedValue(opts?.auditRows ?? []);
  const psyUpdate =
    opts?.psyUpdate ??
    vi.fn().mockImplementation(async ({ where, data }) => ({
      id: where.id,
      role: data.role,
    }));
  const txClient = {
    psychologist: { update: psyUpdate },
    auditLog: { create: vi.fn() },
  };
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
  const prisma = {
    auditLog: { findMany: auditLogFindMany },
    psychologist: { update: psyUpdate },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, auditLogFindMany, psyUpdate, transaction };
}

const SAMPLE_ROW = {
  id: 'caudit11111111111111111111',
  actorType: 'PSYCHOLOGIST' as const,
  actorPsychologistId: 'cpsy99999999999999999999b',
  action: 'CLIENT_VIEWED',
  targetType: 'Client',
  targetId: 'cclient11111111111111111x',
  metadata: { requestId: 'r1' },
  createdAt: new Date('2026-05-26T10:00:00Z'),
};

describe('AdminService.listAuditLogs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the slice + writes ADMIN_AUDIT_LOG_READ audit with filters', async () => {
    const deps = makeDeps({ auditRows: [SAMPLE_ROW] });
    const svc = new AdminService(deps.prisma, deps.audit);

    const page = await svc.listAuditLogs(
      ADMIN_ID,
      { action: 'CLIENT_VIEWED', limit: 100 },
      { requestId: 'r-admin' },
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.id).toBe(SAMPLE_ROW.id);
    expect(page.nextCursor).toBeNull();
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_AUDIT_LOG_READ',
        targetType: 'AuditLog',
        actorPsychologistId: ADMIN_ID,
        metadata: expect.objectContaining({
          filters: expect.objectContaining({ action: 'CLIENT_VIEWED', limit: 100 }),
          returnedCount: 1,
        }),
      }),
    );
  });

  it('does NOT recurse — querying ADMIN_AUDIT_LOG_READ does not write a fresh row', async () => {
    const deps = makeDeps({ auditRows: [] });
    const svc = new AdminService(deps.prisma, deps.audit);

    await svc.listAuditLogs(ADMIN_ID, { action: 'ADMIN_AUDIT_LOG_READ', limit: 100 }, {});

    expect(deps.audit.log).not.toHaveBeenCalled();
  });

  it('paginates with cursor when more rows exist', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...SAMPLE_ROW,
      id: `caudit${i.toString().padStart(20, '0')}`,
    }));
    const deps = makeDeps({ auditRows: rows });
    const svc = new AdminService(deps.prisma, deps.audit);

    const page = await svc.listAuditLogs(ADMIN_ID, { limit: 50 }, {});

    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBe(`caudit${(49).toString().padStart(20, '0')}`);
  });

  it('threads from/to/action filters to Prisma', async () => {
    const deps = makeDeps({ auditRows: [] });
    const svc = new AdminService(deps.prisma, deps.audit);

    await svc.listAuditLogs(
      ADMIN_ID,
      {
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-26T00:00:00Z',
        action: 'NOTE_SIGNED',
        limit: 25,
      },
      {},
    );

    expect(deps.auditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'NOTE_SIGNED',
          createdAt: expect.objectContaining({
            gte: new Date('2026-05-01T00:00:00Z'),
            lt: new Date('2026-05-26T00:00:00Z'),
          }),
        }),
        orderBy: { createdAt: 'desc' },
        take: 26,
      }),
    );
  });
});

describe('AdminService.grantAdmin / revokeAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grantAdmin updates role and writes ADMIN_ROLE_GRANTED audit', async () => {
    const deps = makeDeps();
    const svc = new AdminService(deps.prisma, deps.audit);

    await svc.grantAdmin(ADMIN_ID, OTHER_PSY_ID, { requestId: 'r1' });

    expect(deps.psyUpdate).toHaveBeenCalledWith({
      where: { id: OTHER_PSY_ID },
      data: { role: 'ADMIN' },
      select: { id: true, role: true },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_ROLE_GRANTED',
        targetType: 'Psychologist',
        targetId: OTHER_PSY_ID,
        metadata: expect.objectContaining({ newRole: 'ADMIN' }),
      }),
      expect.anything(),
    );
  });

  it('revokeAdmin downgrades role and writes ADMIN_ROLE_REVOKED audit', async () => {
    const deps = makeDeps();
    const svc = new AdminService(deps.prisma, deps.audit);

    await svc.revokeAdmin(ADMIN_ID, OTHER_PSY_ID, {});

    expect(deps.psyUpdate).toHaveBeenCalledWith({
      where: { id: OTHER_PSY_ID },
      data: { role: 'THERAPIST' },
      select: { id: true, role: true },
    });
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_ROLE_REVOKED',
        metadata: expect.objectContaining({ newRole: 'THERAPIST' }),
      }),
      expect.anything(),
    );
  });
});
