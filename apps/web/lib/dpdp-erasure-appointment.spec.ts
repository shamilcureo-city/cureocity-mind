import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eraseClientPhi } from './dpdp-erasure';

const calls: string[] = [];
let activeShareSubmission = false;
const patientShareFindFirstArgs: unknown[] = [];

function model(name: string) {
  return new Proxy(
    {},
    {
      get: (_target, operation: string) =>
        vi.fn(async (args?: unknown) => {
          calls.push(`${name}.${operation}`);
          if (name === 'session' && operation === 'findMany') return [];
          if (name === 'therapyNote' && operation === 'findMany') return [];
          if (name === 'audioChunk' && operation === 'findMany') return [];
          if (name === 'clientErasureRequest' && operation === 'findMany') return [];
          if (name === 'patientShare' && operation === 'findFirst') {
            patientShareFindFirstArgs.push(args);
            return activeShareSubmission ? { id: 'share-submitting' } : null;
          }
          if (name === 'appointment' && operation === 'updateMany') {
            appointmentUpdates.push(args);
          }
          return operation === 'deleteMany' || operation === 'updateMany'
            ? { count: 0 }
            : undefined;
        }),
    },
  );
}

const appointmentUpdates: unknown[] = [];
const tx = new Proxy(
  {},
  {
    get: (_target, property: string) => {
      if (property === '$queryRaw') {
        return vi.fn(async (strings: TemplateStringsArray) => {
          const sql = Array.from(strings).join('?');
          calls.push(sql.includes('to_regclass') ? 'reminders.discover' : 'audit.find');
          return sql.includes('to_regclass') ? [{ exists: true }] : [];
        });
      }
      if (property === '$executeRaw') {
        return vi.fn(async (strings: TemplateStringsArray) => {
          const sql = Array.from(strings).join('?');
          calls.push(
            sql.includes('DELETE FROM "appointment_reminder_deliveries"')
              ? 'reminders.delete'
              : 'sql.execute',
          );
          return 0;
        });
      }
      return model(property);
    },
  },
);

describe('DPDP appointment erasure invariant', () => {
  beforeEach(() => {
    calls.length = 0;
    appointmentUpdates.length = 0;
    activeShareSubmission = false;
    patientShareFindFirstArgs.length = 0;
  });

  it('makes linked appointments non-enqueueable before deleting reminder outbox rows', async () => {
    const now = new Date('2026-08-18T10:00:00.000Z');

    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'psy-1',
      now,
    });

    expect(appointmentUpdates).toHaveLength(2);
    expect(appointmentUpdates[0]).toMatchObject({
      where: { OR: [{ clientId: 'client-1' }, { sessionId: { in: [] } }] },
      data: { status: 'CANCELLED', startAt: now, endAt: now },
    });
    expect(appointmentUpdates[1]).toMatchObject({
      data: {
        patientNameEncrypted: 'redacted',
        patientPhoneEncrypted: 'redacted',
        clientId: null,
        sessionId: null,
      },
    });
    expect(calls.indexOf('appointment.updateMany')).toBeLessThan(calls.indexOf('reminders.delete'));
    expect(calls.lastIndexOf('appointment.updateMany')).toBeGreaterThan(
      calls.indexOf('reminders.delete'),
    );
  });

  it('refuses to erase client PHI while an external share submission is in flight', async () => {
    activeShareSubmission = true;

    await expect(
      eraseClientPhi(tx as never, {
        clientId: 'client-1',
        erasureRequestId: 'erasure-1',
        psychologistId: 'psy-1',
        now: new Date('2026-08-18T10:00:00.000Z'),
      }),
    ).rejects.toThrow('Client erasure is blocked while provider submission is in progress.');

    expect(calls).not.toContain('client.update');
    expect(calls).not.toContain('patientShare.deleteMany');
  });

  it('does not treat an expired or missing dispatch lease as an active submission', async () => {
    const now = new Date('2026-08-18T10:00:00.000Z');

    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'psy-1',
      now,
    });

    expect(patientShareFindFirstArgs[0]).toMatchObject({
      where: {
        status: 'PENDING',
        dispatchStartedAt: { not: null },
        dispatchLeaseExpiresAt: { gt: now },
      },
    });
    expect(calls).toContain('client.update');
  });
});
