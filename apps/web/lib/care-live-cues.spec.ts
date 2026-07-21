import { describe, it, expect } from 'vitest';
import {
  CARE_TIME_CUES,
  CARE_END_SESSION_MIN_REMAINING_SEC,
  dueCareTimeCues,
  careCueFrame,
} from './care-live-cues';

describe('care live cues', () => {
  it('fires a cue exactly on the tick that crosses its threshold', () => {
    const five = dueCareTimeCues(301, 300);
    expect(five).toHaveLength(1);
    expect(five[0]!.atRemainingSec).toBe(300);

    const two = dueCareTimeCues(121, 120);
    expect(two).toHaveLength(1);
    expect(two[0]!.atRemainingSec).toBe(120);
  });

  it('does not fire before or after the crossing second', () => {
    expect(dueCareTimeCues(320, 319)).toHaveLength(0);
    expect(dueCareTimeCues(300, 299)).toHaveLength(0);
    expect(dueCareTimeCues(119, 118)).toHaveLength(0);
  });

  it('fires every crossed cue when a tick jumps several seconds', () => {
    const both = dueCareTimeCues(305, 118);
    expect(both.map((c) => c.atRemainingSec).sort((a, b) => b - a)).toEqual([300, 120]);
  });

  it('every cue is bracketed and marked do-not-read-aloud', () => {
    for (const cue of CARE_TIME_CUES) {
      expect(cue.text.startsWith('[TIME SIGNAL')).toBe(true);
      expect(cue.text.toLowerCase()).toContain('do not read this aloud');
    }
  });

  it('the wind-down cue is the only one that authorises closing', () => {
    const closers = CARE_TIME_CUES.filter((c) => /begin closing/i.test(c.text));
    expect(closers).toHaveLength(1);
    expect(closers[0]!.atRemainingSec).toBe(120);
    expect(closers[0]!.atRemainingSec).toBeLessThanOrEqual(CARE_END_SESSION_MIN_REMAINING_SEC);
  });

  it('careCueFrame wraps text as a turn_complete client_content frame', () => {
    const frame = JSON.parse(careCueFrame('hello')) as {
      client_content: {
        turns: Array<{ role: string; parts: Array<{ text: string }> }>;
        turn_complete: boolean;
      };
    };
    expect(frame.client_content.turn_complete).toBe(true);
    expect(frame.client_content.turns[0]!.role).toBe('user');
    expect(frame.client_content.turns[0]!.parts[0]!.text).toBe('hello');
  });
});
