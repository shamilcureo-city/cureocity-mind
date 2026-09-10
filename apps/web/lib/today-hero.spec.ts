import { describe, expect, it } from 'vitest';
import { selectAuthoritativeTodayHero } from './today-hero';

type Row = {
  id: string;
  status: 'IN_PROGRESS' | 'SCHEDULED' | 'COMPLETED';
  startedAt?: string | null;
};
const now = new Date('2026-09-09T05:00:00Z');

describe('Today authoritative visible hero', () => {
  it('keeps a session started today prominent even if its old booking is outside day-bounded rows', () => {
    const active: Row = {
      id: 'old-booking-started-today',
      status: 'IN_PROGRESS',
      startedAt: '2026-09-09T04:00:00Z',
    };
    const future: Row = { id: 'next-future', status: 'SCHEDULED' };
    const dayRows: Row[] = [{ id: 'earlier-day-row', status: 'SCHEDULED' }];

    expect(selectAuthoritativeTodayHero(active, future, dayRows, now)).toEqual({
      hero: active,
      remainingDayRows: dayRows,
    });
  });

  it.each([null, '2026-07-11T04:00:00Z', 'invalid', '2026-09-10T04:00:00Z'])(
    'does not mistake missing, old or invalid start data for a current session (%s)',
    (startedAt) => {
      const active: Row = { id: 'unfinished', status: 'IN_PROGRESS', startedAt };
      const future: Row = { id: 'booked-next', status: 'SCHEDULED' };
      expect(selectAuthoritativeTodayHero(active, future, [], now).hero).toBe(future);
      expect(active.status).toBe('IN_PROGRESS');
    },
  );

  it('uses IST rather than UTC for the started-today boundary', () => {
    const active: Row = {
      id: 'started-after-midnight-ist',
      status: 'IN_PROGRESS',
      startedAt: '2026-09-08T19:00:00Z',
    };
    expect(selectAuthoritativeTodayHero(active, null, [], now).hero).toBe(active);
  });

  it('uses authoritative next future and removes its duplicate from the day list', () => {
    const future: Row = { id: 'next-future', status: 'SCHEDULED' };
    const later: Row = { id: 'later', status: 'SCHEDULED' };

    expect(selectAuthoritativeTodayHero<Row>(null, future, [future, later])).toEqual({
      hero: future,
      remainingDayRows: [later],
    });
  });
});
