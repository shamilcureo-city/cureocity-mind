import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  practitioner: vi.fn(),
  settings: vi.fn(),
  raw: vi.fn(),
  sessions: vi.fn(),
  aggregate: vi.fn(),
}));
vi.mock('./prisma', () => ({
  prisma: {
    psychologist: { findUnique: h.practitioner },
    receptionSettings: { findUnique: h.settings },
    $queryRaw: h.raw,
    session: { findMany: h.sessions, aggregate: h.aggregate },
  },
}));
vi.mock('./client-pii', () => ({ decryptClientField: async () => 'Fictional patient' }));
import {
  clinicDayRange,
  clinicTimezone,
  deriveQueueStatus,
  istDayRange,
  loadClinicQueue,
  nextClinicToken,
} from './clinic-queue';
import { prisma } from './prisma';
beforeEach(() => {
  vi.clearAllMocks();
  h.practitioner.mockResolvedValue({ vertical: 'DOCTOR' });
  h.raw.mockResolvedValue([{ exists: true }]);
  h.settings.mockResolvedValue(null);
  h.aggregate.mockResolvedValue({ _max: { tokenNumber: 3 } });
  h.sessions.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
describe('clinic day and lifecycle', () => {
  it('does not roll a UAE clinic into tomorrow at 22:30 Dubai time', () => {
    const at = new Date('2026-10-08T18:30:00Z');
    expect(clinicDayRange(at, 'Asia/Dubai')).toEqual({
      start: new Date('2026-10-07T20:00:00Z'),
      end: new Date('2026-10-08T20:00:00Z'),
      dateKey: '2026-10-08',
    });
    expect(istDayRange(at).dateKey).toBe('2026-10-09');
    expect(clinicDayRange(new Date('2026-10-08T20:00:00Z'), 'Asia/Dubai').dateKey).toBe(
      '2026-10-09',
    );
  });
  it.each([
    ['DOCTOR', 'Asia/Dubai'],
    ['THERAPIST', 'Asia/Kolkata'],
  ])('defaults %s to %s without Reception configuration', async (vertical, timezone) => {
    h.practitioner.mockResolvedValue({ vertical });
    expect(await clinicTimezone('owner')).toBe(timezone);
  });
  it('honors existing India timezone even if reception is disabled', async () => {
    h.settings.mockResolvedValue({ config: { enabled: false, timezone: 'Asia/Kolkata' } });
    expect(await clinicTimezone('owner')).toBe('Asia/Kolkata');
  });
  it('safely defaults when the optional Reception table is not migrated', async () => {
    h.raw.mockResolvedValue([{ exists: false }]);
    expect(await clinicTimezone('owner')).toBe('Asia/Dubai');
    expect(h.settings).not.toHaveBeenCalled();
  });
  it('uses the same Dubai day for reads and token assignment', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T18:30:00Z'));
    expect(await nextClinicToken(prisma as never, 'owner', new Date())).toBe(4);
    await loadClinicQueue('owner');
    expect(h.aggregate.mock.calls[0]?.[0].where.scheduledAt).toEqual(
      h.sessions.mock.calls[0]?.[0].where.scheduledAt,
    );
    expect(h.sessions.mock.calls[0]?.[0].where.scheduledAt.lt).toEqual(
      new Date('2026-10-08T20:00:00Z'),
    );
  });
  it('does not count a rescheduled original appointment as waiting or next up', async () => {
    const row = {
      clientId: 'client',
      scheduledAt: new Date(),
      client: { fullNameEncrypted: 'fake', dateOfBirth: null, isDemo: true },
    };
    h.sessions.mockResolvedValue([
      { ...row, id: 'old', tokenNumber: 1, status: 'RESCHEDULED' },
      { ...row, id: 'new', tokenNumber: 2, status: 'SCHEDULED' },
    ]);
    const queue = await loadClinicQueue('owner');
    expect(deriveQueueStatus('RESCHEDULED')).toBe('CANCELLED');
    expect(queue.waitingCount).toBe(1);
    expect(queue.nextUp?.sessionId).toBe('new');
  });
});
