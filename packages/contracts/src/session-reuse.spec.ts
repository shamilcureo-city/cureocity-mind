import { describe, expect, it } from 'vitest';
import { selectReusableSession } from './session-reuse';

/**
 * Sprint TS3 (F1) — regression coverage for the "start now" reuse decision
 * that stops a scheduled session and a live recording ending up on two
 * different Session rows (the F1 dead-end).
 */
describe('selectReusableSession', () => {
  const range = {
    start: new Date('2026-07-10T00:00:00.000Z'),
    end: new Date('2026-07-11T00:00:00.000Z'),
  };
  const at = (iso: string, status: string) => ({ id: iso, status, scheduledAt: new Date(iso) });

  it('reuses a SCHEDULED session booked for today', () => {
    const s = at('2026-07-10T10:00:00.000Z', 'SCHEDULED');
    expect(selectReusableSession([s], range)).toBe(s);
  });

  it('reuses an IN_PROGRESS session (reconnect to a live consult)', () => {
    const s = at('2026-07-10T10:00:00.000Z', 'IN_PROGRESS');
    expect(selectReusableSession([s], range)).toBe(s);
  });

  it('mints (returns null) when the only session today is COMPLETED', () => {
    const s = at('2026-07-10T09:00:00.000Z', 'COMPLETED');
    expect(selectReusableSession([s], range)).toBeNull();
  });

  it('ignores NO_SHOW / CANCELLED / RESCHEDULED rows', () => {
    const rows = [
      at('2026-07-10T09:00:00.000Z', 'NO_SHOW'),
      at('2026-07-10T09:30:00.000Z', 'CANCELLED'),
      at('2026-07-10T09:45:00.000Z', 'RESCHEDULED'),
    ];
    expect(selectReusableSession(rows, range)).toBeNull();
  });

  it('ignores an open session scheduled outside the IST day window', () => {
    const yesterday = at('2026-07-09T23:00:00.000Z', 'SCHEDULED');
    const tomorrow = at('2026-07-11T01:00:00.000Z', 'SCHEDULED');
    expect(selectReusableSession([yesterday, tomorrow], range)).toBeNull();
  });

  it('picks the EARLIEST open session when several are booked today', () => {
    const later = at('2026-07-10T15:00:00.000Z', 'SCHEDULED');
    const earlier = at('2026-07-10T10:00:00.000Z', 'SCHEDULED');
    expect(selectReusableSession([later, earlier], range)).toBe(earlier);
  });

  it('returns null for an empty candidate list', () => {
    expect(selectReusableSession([], range)).toBeNull();
  });

  it('treats the window as half-open [start, end): a session exactly at end mints', () => {
    const atEnd = at('2026-07-11T00:00:00.000Z', 'SCHEDULED');
    expect(selectReusableSession([atEnd], range)).toBeNull();
  });
});
