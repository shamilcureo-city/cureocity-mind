import { describe, expect, it } from 'vitest';
import { selectAuthoritativeTodayHero } from './today-hero';

type Row = { id: string; status: 'IN_PROGRESS' | 'SCHEDULED' | 'COMPLETED' };

describe('Today authoritative visible hero', () => {
  it('prefers the authoritative active session even when it is outside day-bounded rows', () => {
    const active: Row = { id: 'active-yesterday', status: 'IN_PROGRESS' };
    const future: Row = { id: 'next-future', status: 'SCHEDULED' };
    const dayRows: Row[] = [{ id: 'earlier-day-row', status: 'SCHEDULED' }];

    expect(selectAuthoritativeTodayHero(active, future, dayRows)).toEqual({
      hero: active,
      remainingDayRows: dayRows,
    });
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
