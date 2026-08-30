import { describe, expect, it } from 'vitest';
import { suggestFollowUp } from './follow-up-suggestion';

describe('follow-up suggestion', () => {
  it('suggests the same local time one week after the completed session', () => {
    expect(suggestFollowUp(new Date('2026-08-30T04:30:00.000Z'))).toEqual({
      cadenceDays: 7,
      date: '2026-09-06',
      time: '10:00',
    });
  });

  it('keeps the cadence editable by accepting an alternative number of days', () => {
    expect(suggestFollowUp(new Date('2026-08-30T04:30:00.000Z'), 14).date).toBe('2026-09-13');
  });

  it('rolls a late closeout suggestion forward until it is in the future', () => {
    expect(
      suggestFollowUp(
        new Date('2026-08-01T04:30:00.000Z'),
        7,
        new Date('2026-08-30T00:00:00.000Z'),
      ),
    ).toEqual({ cadenceDays: 7, date: '2026-09-05', time: '10:00' });
  });
});
