import { describe, expect, it } from 'vitest';
import { isErasureDeletionCronAuthorized } from '@/app/api/v1/cron/erasure-object-deletion/route';

describe('DPDP object-deletion cron authentication', () => {
  it('fails closed without CRON_SECRET', () => {
    expect(isErasureDeletionCronAuthorized('Bearer guessed', {})).toBe(false);
  });

  it('requires an exact bearer secret and does not trust a cron marker alone', () => {
    const env = { CRON_SECRET: 'worker-secret' };
    expect(isErasureDeletionCronAuthorized(null, env)).toBe(false);
    expect(isErasureDeletionCronAuthorized('Bearer wrong', env)).toBe(false);
    expect(isErasureDeletionCronAuthorized('Bearer worker-secret', env)).toBe(true);
  });
});
