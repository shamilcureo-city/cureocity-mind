import { describe, expect, it, vi } from 'vitest';

const globalRead = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('A transaction helper escaped to the global connection pool');
  }),
);
vi.mock('./prisma', () => ({ prisma: new Proxy({}, { get: globalRead }) }));
import { getEntitlement } from './billing';
import { computeSessionDefaults } from './session-defaults';

describe('reception booking transaction helpers', () => {
  it('reads entitlement entirely through the supplied transaction', async () => {
    const db = {
      billingAccount: { findUnique: vi.fn(async () => null) },
      session: { count: vi.fn(async () => 2) },
    };
    const result = await getEntitlement('owner-1', db as never);
    expect(result).toMatchObject({ trialUsed: 2, monthlyUsed: 2, isPaidActive: false });
    expect(db.session.count).toHaveBeenCalledTimes(2);
    expect(globalRead).not.toHaveBeenCalled();
  });

  it('keeps all defaults reads, including the follow-up plan-age count, in the transaction', async () => {
    const db = {
      client: {
        findUnique: vi.fn(async () => ({
          psychologistId: 'owner-1',
          deletedAt: null,
          preferredLanguage: 'en',
          spokenLanguages: [],
        })),
      },
      psychologist: {
        findUnique: vi.fn(async () => ({ vertical: 'THERAPIST', defaultOutputLanguage: 'en' })),
      },
      treatmentPlan: {
        findFirst: vi.fn(async () => ({
          body: { modality: 'CBT' },
          confirmedAt: new Date('2026-09-01T00:00:00Z'),
        })),
      },
      session: {
        count: vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(1),
        findFirst: vi.fn(async () => null),
      },
      consent: { findMany: vi.fn(async () => []) },
      instrumentResponse: { findFirst: vi.fn(async () => null) },
    };
    const result = await computeSessionDefaults('client-1', 'owner-1', db as never);
    expect(result).toMatchObject({ kind: 'REVIEW', modality: 'CBT', sessionsCompleted: 10 });
    expect(db.session.count).toHaveBeenCalledTimes(2);
    expect(globalRead).not.toHaveBeenCalled();
  });
});
