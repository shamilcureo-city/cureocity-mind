import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PsychologistsService } from './psychologists.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { CreatePsychologistInput } from '@cureocity/contracts';

const validInput: CreatePsychologistInput = {
  fullName: 'Dr. Priya Menon',
  email: 'priya@example.in',
  phone: '+919876543210',
  rciNumber: 'A12345',
};

function makeDeps() {
  const findUnique = vi.fn();
  const create = vi.fn();
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ psychologist: { create } }),
  );
  const prisma = {
    psychologist: { findUnique },
    $transaction: transaction,
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, findUnique, create, transaction };
}

describe('PsychologistsService.register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a new psychologist and writes an audit log', async () => {
    const { prisma, audit, findUnique, create } = makeDeps();
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'psy_new', firebaseUid: 'fb_1', email: validInput.email });

    const svc = new PsychologistsService(prisma, audit);
    const result = await svc.register('fb_1', validInput, { ip: '1.2.3.4' });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        firebaseUid: 'fb_1',
        email: validInput.email,
        status: 'PENDING_VERIFICATION',
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'SYSTEM',
        action: 'PSYCHOLOGIST_REGISTERED',
        targetType: 'Psychologist',
        targetId: 'psy_new',
      }),
      expect.anything(),
    );
    expect(result.id).toBe('psy_new');
  });

  it('is idempotent on firebaseUid (returns existing without writing)', async () => {
    const { prisma, audit, findUnique, create } = makeDeps();
    findUnique.mockResolvedValue({ id: 'psy_existing', firebaseUid: 'fb_dup' });

    const svc = new PsychologistsService(prisma, audit);
    const result = await svc.register('fb_dup', validInput, {});

    expect(result.id).toBe('psy_existing');
    expect(create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('translates P2002 unique-violation to 409 Conflict', async () => {
    const { prisma, audit, findUnique, create } = makeDeps();
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { target: ['email'] },
      }),
    );

    const svc = new PsychologistsService(prisma, audit);
    await expect(svc.register('fb_new', validInput, {})).rejects.toBeInstanceOf(ConflictException);
  });
});
