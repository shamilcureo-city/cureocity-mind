import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eraseClientPhi } from './dpdp-erasure';

const calls: string[] = [];
let activeShareSubmission = false;
const patientShareFindFirstArgs: unknown[] = [];
const recoveryDeletionArgs: unknown[] = [];
const preparationDeletionArgs: unknown[] = [];
let preparationTableExists = true;
let preparationDeletionFails = false;
let usageTableExists = true;
let usageDeletionFails = false;
const usageDeletionArgs: unknown[] = [];
let sessionRows: Array<{ id: string }> = [];

function model(name: string) {
  return new Proxy(
    {},
    {
      get: (_target, operation: string) =>
        vi.fn(async (args?: unknown) => {
          calls.push(`${name}.${operation}`);
          if (name === 'noteEditRecovery' && operation === 'deleteMany')
            recoveryDeletionArgs.push(args);
          if (name === 'mindSessionPreparation' && operation === 'deleteMany') {
            preparationDeletionArgs.push(args);
            if (preparationDeletionFails) throw new Error('preparation deletion failed');
          }
          if (name === 'sessionUsageConnection' && operation === 'deleteMany') {
            usageDeletionArgs.push(args);
            if (usageDeletionFails) throw new Error('usage deletion failed');
          }
          if (name === 'session' && operation === 'findMany') return sessionRows;
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
          if (sql.includes('session_usage_connections')) {
            calls.push('usage.discover');
            return [{ exists: usageTableExists }];
          }
          if (sql.includes('mind_session_preparations')) {
            calls.push('preparation.discover');
            return [{ exists: preparationTableExists }];
          }
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
    recoveryDeletionArgs.length = 0;
    preparationDeletionArgs.length = 0;
    preparationTableExists = true;
    preparationDeletionFails = false;
    usageTableExists = true;
    usageDeletionFails = false;
    usageDeletionArgs.length = 0;
    sessionRows = [];
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
    expect(recoveryDeletionArgs).toEqual([{ where: { sessionId: { in: [] } } }]);
    expect(calls.indexOf('noteEditRecovery.deleteMany')).toBeLessThan(
      calls.indexOf('noteDraft.updateMany'),
    );
    expect(calls).toContain('mindManualNoteDraft.deleteMany');
    expect(calls).toContain('mindInstrumentDraft.deleteMany');
    expect(calls).toContain('clientMindCareRecord.deleteMany');
    expect(calls).toContain('mindSessionPreparation.deleteMany');
    expect(calls).toContain('sessionUsageConnection.deleteMany');
    expect(usageDeletionArgs).toEqual([{ where: { clientId: 'client-1' } }]);
    expect(calls.indexOf('client.update')).toBeLessThan(
      calls.indexOf('sessionUsageConnection.deleteMany'),
    );
    expect(calls.indexOf('sessionUsageConnection.deleteMany')).toBeLessThan(
      calls.indexOf('session.updateMany'),
    );
    expect(calls.indexOf('client.update')).toBeLessThan(
      calls.indexOf('mindSessionPreparation.deleteMany'),
    );
    expect(calls.indexOf('mindSessionPreparation.deleteMany')).toBeLessThan(
      calls.indexOf('session.updateMany'),
    );
    expect(calls.indexOf('mindManualNoteDraft.deleteMany')).toBeLessThan(
      calls.indexOf('session.updateMany'),
    );
    expect(calls.indexOf('exerciseAssignment.deleteMany')).toBeLessThan(
      calls.indexOf('sessionAgreement.deleteMany'),
    );
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
  it('erases checkpoints and tombstones only for the erased client session set', async () => {
    sessionRows = [{ id: 'session-1' }, { id: 'session-2' }];
    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'psy-1',
      now: new Date('2026-08-18T10:00:00.000Z'),
    });
    expect(recoveryDeletionArgs).toEqual([
      { where: { sessionId: { in: ['session-1', 'session-2'] } } },
    ]);
    expect(preparationDeletionArgs).toEqual([
      { where: { sessionId: { in: ['session-1', 'session-2'] } } },
    ]);
  });

  it('skips only confirmed absent pre-migration preparation storage', async () => {
    preparationTableExists = false;
    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'psy-1',
      now: new Date('2026-09-13T09:00:00Z'),
    });
    expect(calls).toContain('preparation.discover');
    expect(preparationDeletionArgs).toEqual([]);
  });

  it('propagates preparation deletion failure so fulfilment cannot commit', async () => {
    preparationDeletionFails = true;
    await expect(
      eraseClientPhi(tx as never, {
        clientId: 'client-1',
        erasureRequestId: 'erasure-1',
        psychologistId: 'psy-1',
        now: new Date('2026-09-13T09:00:00Z'),
      }),
    ).rejects.toThrow('preparation deletion failed');
    expect(calls).not.toContain('session.updateMany');
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
  it('skips usage deletion only for confirmed absence, never the reporting flag', async () => {
    usageTableExists = false;
    await eraseClientPhi(tx as never, {
      clientId: 'client-1',
      erasureRequestId: 'erasure-1',
      psychologistId: 'psy-1',
      now: new Date(),
    });
    expect(calls).toContain('usage.discover');
    expect(usageDeletionArgs).toEqual([]);
  });
  it('propagates usage deletion failure so erasure cannot claim fulfilment', async () => {
    usageDeletionFails = true;
    await expect(
      eraseClientPhi(tx as never, {
        clientId: 'client-1',
        erasureRequestId: 'erasure-1',
        psychologistId: 'psy-1',
        now: new Date(),
      }),
    ).rejects.toThrow('usage deletion failed');
    expect(calls).not.toContain('session.updateMany');
  });
});
