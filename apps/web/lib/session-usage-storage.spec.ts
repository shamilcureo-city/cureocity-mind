import { describe, expect, it, vi } from 'vitest';
import { hasSessionUsageConnectionStorage } from './session-usage-storage';

describe('session usage storage during rolling releases', () => {
  it.each([true, false])('uses only confirmed table existence %s', async (exists) => {
    const $queryRaw = vi.fn().mockResolvedValue([{ exists }]);
    await expect(hasSessionUsageConnectionStorage({ $queryRaw } as never)).resolves.toBe(exists);
    expect($queryRaw.mock.calls[0]?.[0].join('')).toContain(
      "to_regclass('public.session_usage_connections')",
    );
  });
  it.each(
    [
      [],
      [{}],
      [{ exists: null }],
      [{ exists: 'false' }],
      [{ exists: false }, { exists: true }],
    ].map((rows) => ({ rows })),
  )('fails closed for ambiguous catalog result %j', async ({ rows }) => {
    await expect(
      hasSessionUsageConnectionStorage({ $queryRaw: vi.fn().mockResolvedValue(rows) } as never),
    ).rejects.toThrow('Session usage storage availability could not be verified');
  });
  it('propagates outage instead of treating usage history as absent', async () => {
    await expect(
      hasSessionUsageConnectionStorage({
        $queryRaw: vi.fn().mockRejectedValue(new Error('offline')),
      } as never),
    ).rejects.toThrow('offline');
  });
});
