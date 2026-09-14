import { describe, expect, it, vi } from 'vitest';
import { hasMindSessionPreparationStorage } from './mind-session-preparation-storage';

describe('preparation privacy availability across schema rollout', () => {
  it.each([true, false])('returns only the catalog-confirmed availability %s', async (exists) => {
    const $queryRaw = vi.fn().mockResolvedValue([{ exists }]);
    await expect(hasMindSessionPreparationStorage({ $queryRaw } as never)).resolves.toBe(exists);
    expect($queryRaw.mock.calls[0]?.[0].join('')).toContain(
      "to_regclass('public.mind_session_preparations')",
    );
  });
  it.each([
    { rows: [] },
    { rows: [{}] },
    { rows: [{ exists: null }] },
    { rows: [{ exists: 'false' }] },
    { rows: [{ exists: false }, { exists: true }] },
  ])('fails closed for ambiguous catalog result %j', async ({ rows }) => {
    await expect(
      hasMindSessionPreparationStorage({ $queryRaw: vi.fn().mockResolvedValue(rows) } as never),
    ).rejects.toThrow('Preparation storage availability could not be verified');
  });
  it('does not reinterpret a discovery outage as an absent table', async () => {
    await expect(
      hasMindSessionPreparationStorage({
        $queryRaw: vi.fn().mockRejectedValue(new Error('database unavailable')),
      } as never),
    ).rejects.toThrow('database unavailable');
  });
});
