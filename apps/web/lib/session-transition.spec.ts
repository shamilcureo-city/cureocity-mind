import { describe, expect, it, vi } from 'vitest';
import {
  conditionalSessionTransition,
  finalizeLiveSession,
  sessionConcurrentModificationResponse,
} from './session-transition';

function transaction(count: number) {
  const row = { id: 'session-1', status: 'IN_PROGRESS' };
  return {
    session: {
      updateMany: vi.fn().mockResolvedValue({ count }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
    },
    row,
  };
}

function stateTransaction(status: string) {
  const row = { id: 'session-1', status };
  return {
    session: {
      updateMany: vi.fn(async ({ where, data }) => {
        if (row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => row),
    },
    row,
  };
}

describe('conditional Session lifecycle transition', () => {
  it('updates only the expected current status and returns the transitioned row', async () => {
    const tx = transaction(1);
    const startedAt = new Date('2026-08-18T10:00:00Z');

    await expect(
      conditionalSessionTransition(tx as never, {
        sessionId: 'session-1',
        expectedStatus: 'SCHEDULED',
        data: { status: 'IN_PROGRESS', startedAt },
      }),
    ).resolves.toBe(tx.row);

    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'SCHEDULED' },
      data: { status: 'IN_PROGRESS', startedAt },
    });
    expect(tx.session.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    });
  });

  it('stops the transaction before lifecycle side effects when another transition wins', async () => {
    const tx = transaction(0);
    const lifecycleAudit = vi.fn();

    await expect(
      (async () => {
        await conditionalSessionTransition(tx as never, {
          sessionId: 'session-1',
          expectedStatus: 'SCHEDULED',
          data: { status: 'NO_SHOW' },
        });
        await lifecycleAudit();
      })(),
    ).rejects.toMatchObject({ code: 'SESSION_CONCURRENT_MODIFICATION' });

    expect(lifecycleAudit).not.toHaveBeenCalled();
    expect(tx.session.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('finalizes live persistence only from IN_PROGRESS and writes one lifecycle audit', async () => {
    const tx = transaction(1);
    const persistDraft = vi.fn().mockResolvedValue({ id: 'draft-1' });
    const writeLifecycleAudit = vi.fn().mockResolvedValue(undefined);

    await expect(
      finalizeLiveSession(tx as never, {
        sessionId: 'session-1',
        endedAt: new Date('2026-08-18T10:30:00Z'),
        persistDraft,
        writeLifecycleAudit,
      }),
    ).resolves.toEqual({ id: 'draft-1' });

    expect(persistDraft).toHaveBeenCalledOnce();
    expect(writeLifecycleAudit).toHaveBeenCalledOnce();
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', status: 'IN_PROGRESS' },
      data: { status: 'COMPLETED', endedAt: new Date('2026-08-18T10:30:00Z') },
    });
  });

  it.each(['NO_SHOW', 'CANCELLED', 'COMPLETED'])(
    'does not overwrite notes or audit when live completion loses to %s',
    async (status) => {
      const tx = stateTransaction(status);
      const persistDraft = vi.fn();
      const writeLifecycleAudit = vi.fn();

      await expect(
        finalizeLiveSession(tx as never, {
          sessionId: 'session-1',
          endedAt: new Date('2026-08-18T10:30:00Z'),
          persistDraft,
          writeLifecycleAudit,
        }),
      ).rejects.toMatchObject({ code: 'SESSION_CONCURRENT_MODIFICATION' });

      expect(persistDraft).not.toHaveBeenCalled();
      expect(writeLifecycleAudit).not.toHaveBeenCalled();
    },
  );

  it('maps a lost transition to a stable 409 response code', async () => {
    const tx = transaction(0);

    try {
      await conditionalSessionTransition(tx as never, {
        sessionId: 'session-1',
        expectedStatus: 'IN_PROGRESS',
        data: { status: 'COMPLETED' },
      });
      throw new Error('expected transition to fail');
    } catch (error) {
      const response = sessionConcurrentModificationResponse(error);
      expect(response?.status).toBe(409);
      await expect(response?.json()).resolves.toEqual({
        error: 'The session changed while this request was processed',
        code: 'SESSION_CONCURRENT_MODIFICATION',
      });
    }
  });
});
