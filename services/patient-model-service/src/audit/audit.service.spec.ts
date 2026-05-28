import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AuditService } from './audit.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrisma() {
  const create = vi.fn().mockResolvedValue({ id: 'audit_1' });
  return {
    prisma: { auditLog: { create } } as unknown as PrismaService,
    create,
  };
}

describe('AuditService', () => {
  it('writes an audit row using the injected client when no tx', async () => {
    const { prisma, create } = makePrisma();
    const svc = new AuditService(prisma);
    await svc.log({
      actorType: 'SYSTEM',
      action: 'PSYCHOLOGIST_REGISTERED',
      targetType: 'Psychologist',
      targetId: 'psy_1',
      metadata: { ip: '127.0.0.1' },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      actorType: 'SYSTEM',
      actorPsychologistId: null,
      action: 'PSYCHOLOGIST_REGISTERED',
      targetType: 'Psychologist',
      targetId: 'psy_1',
      metadata: { ip: '127.0.0.1' },
    });
  });

  it('uses the provided tx client when given', async () => {
    const { prisma } = makePrisma();
    const txCreate = vi.fn().mockResolvedValue({ id: 'audit_2' });
    const tx = { auditLog: { create: txCreate } } as unknown as Prisma.TransactionClient;
    const svc = new AuditService(prisma);
    await svc.log(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: 'psy_99',
        action: 'CLIENT_CREATED',
        targetType: 'Client',
        targetId: 'c_42',
      },
      tx,
    );
    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(txCreate.mock.calls[0]![0].data.actorPsychologistId).toBe('psy_99');
  });

  it('writes Prisma.JsonNull when metadata is undefined', async () => {
    const { prisma, create } = makePrisma();
    const svc = new AuditService(prisma);
    await svc.log({
      actorType: 'SYSTEM',
      action: 'PSYCHOLOGIST_REGISTERED',
      targetType: 'Psychologist',
      targetId: 'psy_1',
    });
    expect(create.mock.calls[0]![0].data.metadata).toBe(Prisma.JsonNull);
  });
});
