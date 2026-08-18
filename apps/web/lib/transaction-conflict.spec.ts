import { describe, expect, it } from 'vitest';
import { transactionConflictResponse } from './transaction-conflict';

async function expectConflict(error: unknown): Promise<void> {
  const response = transactionConflictResponse(error);
  expect(response?.status).toBe(409);
  await expect(response?.json()).resolves.toEqual({
    error: 'The appointment or session changed concurrently; please refresh and try again.',
    code: 'LIFECYCLE_TRANSACTION_CONFLICT',
  });
}

describe('transactionConflictResponse', () => {
  it.each([
    [{ code: 'P2034' }, 'Prisma transaction conflict'],
    [{ code: '40P01' }, 'PostgreSQL deadlock'],
    [{ code: '40001' }, 'PostgreSQL serialization failure'],
    [{ code: 'P2010', meta: { code: '40P01' } }, 'Prisma raw-query deadlock'],
  ])('maps %s to a stable 409 for %s', async (error, _description) => {
    await expectConflict(error);
  });

  it('does not map unrelated failures', () => {
    expect(transactionConflictResponse({ code: 'P2002' })).toBeNull();
    expect(transactionConflictResponse(new Error('network failed'))).toBeNull();
  });
});
