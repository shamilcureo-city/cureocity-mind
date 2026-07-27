import { describe, expect, it } from 'vitest';
import { roomNameFor, withinJoinWindow } from './livekit';

describe('withinJoinWindow', () => {
  const start = new Date('2026-08-03T04:30:00.000Z'); // 10:00 IST
  const end = new Date('2026-08-03T05:30:00.000Z'); // 11:00 IST

  it('opens 30 minutes before the slot', () => {
    expect(withinJoinWindow(start, end, new Date('2026-08-03T03:59:00.000Z'))).toBe(false);
    expect(withinJoinWindow(start, end, new Date('2026-08-03T04:00:00.000Z'))).toBe(true);
  });

  it('stays open through the session and one hour past its end', () => {
    expect(withinJoinWindow(start, end, new Date('2026-08-03T05:00:00.000Z'))).toBe(true);
    expect(withinJoinWindow(start, end, new Date('2026-08-03T06:30:00.000Z'))).toBe(true);
    expect(withinJoinWindow(start, end, new Date('2026-08-03T06:31:00.000Z'))).toBe(false);
  });

  it('refuses the day before — a leaked link is time-bounded', () => {
    expect(withinJoinWindow(start, end, new Date('2026-08-02T04:30:00.000Z'))).toBe(false);
  });
});

describe('roomNameFor', () => {
  it('is stable per appointment', () => {
    expect(roomNameFor('abc123')).toBe('appt_abc123');
  });
});
