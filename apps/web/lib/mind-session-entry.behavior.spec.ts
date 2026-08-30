import { describe, expect, it, vi } from 'vitest';
import { coordinateMindSessionStart } from './mind-session-start';

/** Sprint 1 acceptance behavior: every entry path hands the same selected session to capture. */
describe('Mind session entry behavior', () => {
  for (const source of ['TODAY', 'WALK_IN', 'RECORD', 'CLIENT'] as const) {
    it(`reuses the selected session and authorizes only after active capture from ${source}`, async () => {
      const order: string[] = [];
      const authorizeCapture = vi.fn(async () => {
        order.push('authorize');
      });

      const result = await coordinateMindSessionStart(
        { clientId: 'client-1', sessionId: 'session-1', captureMode: 'LIVE' },
        {
          selectOrReuseSession: async () => {
            order.push(`select:${source}`);
            return { id: 'session-1', status: 'SCHEDULED' };
          },
          resolveConsent: async (sessionId) => {
            order.push('consent');
            return { sessionId, snapshotRecorded: true };
          },
          runPreflight: async () => {
            order.push('preflight');
            return { ready: true };
          },
          activateCapture: async () => {
            order.push('capture-active');
            return { active: true };
          },
          authorizeCapture,
        },
      );

      expect(result.sessionId).toBe('session-1');
      expect(order).toEqual([
        `select:${source}`,
        'consent',
        'preflight',
        'capture-active',
        'authorize',
      ]);
      expect(authorizeCapture).toHaveBeenCalledWith('session-1', 'LIVE');
    });
  }

  it('resumes in-progress work without creating a replacement or reauthorizing', async () => {
    const authorizeCapture = vi.fn();
    const result = await coordinateMindSessionStart(
      { clientId: 'client-1', sessionId: 'session-1', captureMode: 'LIVE' },
      {
        selectOrReuseSession: async () => ({ id: 'session-1', status: 'IN_PROGRESS' }),
        resolveConsent: vi.fn(),
        runPreflight: async () => ({ ready: true }),
        activateCapture: async () => ({ active: true }),
        authorizeCapture,
      },
    );
    expect(result).toMatchObject({ sessionId: 'session-1', resumed: true });
    expect(authorizeCapture).not.toHaveBeenCalled();
  });
});
