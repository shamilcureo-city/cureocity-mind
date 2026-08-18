import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eraseClientPhi } from './dpdp-erasure';

const calls: string[] = [];

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
});
