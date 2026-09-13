import { describe, expect, it } from 'vitest';
import { SessionUsageSummarySchema } from './session-usage-summary';
const summary = {
  version: 1,
  sessionId: 'fictional',
  recordedSubtotalInr: null,
  liveConnectionSubtotalInr: null,
  webCallSubtotalInr: null,
  legacySubtotalInr: null,
  lowerBound: false,
  coverage: 'NO_RECORDED_USAGE',
  coverageReasons: [],
  connections: { registered: 1, receipted: 0, open: 1, finalReported: 0, incomplete: 0 },
  webCallRecords: 0,
  legacyOverlap: 'NONE',
  usageBasis: 'RECORDED_ESTIMATE',
  reconciliation: 'NOT_RECONCILED',
};
describe('session usage summary contract', () => {
  it('distinguishes absent and canonical zero money', () => {
    expect(SessionUsageSummarySchema.parse(summary).recordedSubtotalInr).toBeNull();
    expect(
      SessionUsageSummarySchema.parse({ ...summary, recordedSubtotalInr: '0.0000' })
        .recordedSubtotalInr,
    ).toBe('0.0000');
  });
  it.each([-1, 0, '1.23', '-1.0000', 'NaN'])(
    'refuses non-canonical or numeric amount %s',
    (recordedSubtotalInr) => {
      expect(SessionUsageSummarySchema.safeParse({ ...summary, recordedSubtotalInr }).success).toBe(
        false,
      );
    },
  );
  it('never accepts a claimed invoice or reconciliation and rejects extra secrets', () => {
    expect(
      SessionUsageSummarySchema.safeParse({ ...summary, reconciliation: 'RECONCILED' }).success,
    ).toBe(false);
    expect(
      SessionUsageSummarySchema.safeParse({ ...summary, serviceToken: 'secret' }).success,
    ).toBe(false);
  });
});
