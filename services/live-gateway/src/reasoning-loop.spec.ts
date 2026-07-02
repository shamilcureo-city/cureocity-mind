import { describe, expect, it } from 'vitest';
import type { Utterance } from '@cureocity/contracts';
import { ReasoningScheduler } from './reasoning-loop';

function utt(id: string): Utterance {
  return { id, speaker: 'patient', text: `text ${id}`, tStartMs: 0, tEndMs: 1000 };
}

describe('ReasoningScheduler', () => {
  it('returns null when nothing is pending', () => {
    const t = 0;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    expect(s.takeDue()).toBeNull();
  });

  it('runs immediately on the first pending batch', () => {
    const t = 1000;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    s.enqueue(utt('u1'));
    const batch = s.takeDue();
    expect(batch?.map((u) => u.id)).toEqual(['u1']);
    expect(s.hasPending).toBe(false);
  });

  it('debounces a second batch within minGap, then releases after it', () => {
    let t = 0;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    s.enqueue(utt('u1'));
    expect(s.takeDue()?.length).toBe(1); // first run at t=0

    t = 2000; // 2s later — within the 4s gap
    s.enqueue(utt('u2'));
    expect(s.takeDue()).toBeNull(); // debounced
    expect(s.hasPending).toBe(true);

    t = 4500; // now >4s since last run
    expect(s.takeDue()?.map((u) => u.id)).toEqual(['u2']);
  });

  it('coalesces multiple pending utterances into one batch', () => {
    let t = 0;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    s.enqueue(utt('u1'));
    s.takeDue(); // consume the first

    t = 1000;
    s.enqueue(utt('u2'));
    t = 2000;
    s.enqueue(utt('u3'));
    expect(s.takeDue()).toBeNull(); // still within gap

    t = 5000;
    expect(s.takeDue()?.map((u) => u.id)).toEqual(['u2', 'u3']); // both, one batch
  });

  it('force-releases once the oldest pending waits forceMs', () => {
    let t = 0;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    s.enqueue(utt('u1'));
    s.takeDue();

    t = 1000;
    s.enqueue(utt('u2')); // pending since t=1000
    t = 3000;
    expect(s.takeDue()).toBeNull(); // within gap AND within force

    t = 21500; // >20s since u2 queued → force
    expect(s.takeDue()?.map((u) => u.id)).toEqual(['u2']);
  });

  it('flush() releases everything regardless of timing', () => {
    let t = 0;
    const s = new ReasoningScheduler({ minGapMs: 4000, forceMs: 20000 }, () => t);
    s.enqueue(utt('u1'));
    s.takeDue();
    t = 500;
    s.enqueue(utt('u2'));
    expect(s.flush().map((u) => u.id)).toEqual(['u2']);
    expect(s.flush()).toEqual([]); // nothing left
  });
});
