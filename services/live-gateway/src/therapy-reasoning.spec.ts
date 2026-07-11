import { describe, expect, it } from 'vitest';
import type { TherapyReasoningModelOutput, Utterance } from '@cureocity/contracts';
import { TherapyReasoningStore } from './therapy-reasoning';

function utt(id: string, text: string, speaker: Utterance['speaker'] = 'patient'): Utterance {
  return { id, speaker, text, tStartMs: 0, tEndMs: 1000 };
}

const EMPTY: TherapyReasoningModelOutput = { riskWatch: [], askNext: [], threads: [] };

describe('TherapyReasoningStore', () => {
  it('citation-gates a LIVE risk/ask/thread: drops uncited, keeps cited', () => {
    const store = new TherapyReasoningStore(null);
    store.registerUtterances([utt('u1', 'I feel completely hopeless')]);
    const model: TherapyReasoningModelOutput = {
      riskWatch: [
        {
          id: 'r1',
          label: 'Hopeless cue',
          why: 'client voiced hopelessness',
          severity: 'high',
          source: 'LIVE',
          sourceUtteranceIds: ['u1'], // real
        },
        {
          id: 'r2',
          label: 'Fabricated cue',
          why: 'no basis',
          severity: 'high',
          source: 'LIVE',
          sourceUtteranceIds: ['u999'], // not seen → dropped
        },
      ],
      askNext: [],
      threads: [
        {
          id: 't1',
          topic: 'Ghost thread',
          note: 'never said',
          mentions: 1,
          sourceUtteranceIds: ['u999'], // dropped
        },
      ],
    };
    const { snapshot } = store.apply(model, 10 * 60_000);
    expect(snapshot.riskWatch.map((r) => r.label)).toEqual(['Hopeless cue']);
    expect(snapshot.threads).toHaveLength(0);
  });

  it('seeds CARRIED questions as ask-next (no citation needed)', () => {
    const store = new TherapyReasoningStore({
      carriedQuestions: [{ question: 'When did this start?', why: 'timeline' }],
      priorRisk: false,
      plannedMinutes: 50,
    });
    const { snapshot } = store.apply(EMPTY, 60_000);
    const carried = snapshot.askNext.filter((a) => a.source === 'CARRIED');
    expect(carried).toHaveLength(1);
    expect(carried[0]?.question).toBe('When did this start?');
  });

  it('always surfaces the deterministic SI re-check when prior risk is on file', () => {
    const store = new TherapyReasoningStore({
      carriedQuestions: [],
      priorRisk: true,
      plannedMinutes: 50,
    });
    const { snapshot } = store.apply(EMPTY, 60_000);
    const recheck = snapshot.riskWatch.find((r) => r.source === 'CARRIED_RISK');
    expect(recheck).toBeDefined();
    expect(recheck?.label).toBe('Re-check ideation');
  });

  it('dismiss removes the SI re-check and does not resurrect it', () => {
    const store = new TherapyReasoningStore({
      carriedQuestions: [],
      priorRisk: true,
      plannedMinutes: 50,
    });
    store.apply(EMPTY, 60_000);
    expect(store.dismiss('risk-recheck')).toBe(true);
    const after = store.recompute(60_000);
    expect(after.snapshot.riskWatch.find((r) => r.source === 'CARRIED_RISK')).toBeUndefined();
    // Re-applying a pass must not bring it back.
    const reapplied = store.apply(EMPTY, 60_000);
    expect(reapplied.snapshot.riskWatch.find((r) => r.source === 'CARRIED_RISK')).toBeUndefined();
  });

  it('computes the session arc phase from elapsed vs planned', () => {
    const store = new TherapyReasoningStore({
      carriedQuestions: [],
      priorRisk: false,
      plannedMinutes: 50,
    });
    expect(store.apply(EMPTY, 2 * 60_000).snapshot.arc?.phase).toBe('opening');
    expect(store.recompute(20 * 60_000).snapshot.arc?.phase).toBe('working');
    expect(store.recompute(46 * 60_000).snapshot.arc?.phase).toBe('closing');
    expect(store.recompute(60 * 60_000).snapshot.arc?.phase).toBe('overrun');
  });

  it('gives stable ids to repeated threads and accumulates mentions', () => {
    const store = new TherapyReasoningStore(null);
    store.registerUtterances([utt('u1', 'my brother again'), utt('u2', 'the brother thing')]);
    const mk = (mentions: number, ids: string[]): TherapyReasoningModelOutput => ({
      riskWatch: [],
      askNext: [],
      threads: [
        {
          id: 'tx',
          topic: 'Conflict with brother',
          note: 'unexplored',
          mentions,
          sourceUtteranceIds: ids,
        },
      ],
    });
    const first = store.apply(mk(1, ['u1']), 60_000);
    const id = first.snapshot.threads[0]!.id;
    const second = store.apply(mk(2, ['u2']), 60_000);
    expect(second.snapshot.threads).toHaveLength(1);
    expect(second.snapshot.threads[0]!.id).toBe(id); // stable
    expect(second.snapshot.threads[0]!.mentions).toBe(2); // accumulated
  });

  it('only reports changed=true when content or arc phase changes, not on a minute tick', () => {
    const store = new TherapyReasoningStore({
      carriedQuestions: [],
      priorRisk: false,
      plannedMinutes: 50,
    });
    store.apply(EMPTY, 20 * 60_000); // establishes "working"
    const tick = store.recompute(21 * 60_000); // still working, no content change
    expect(tick.changed).toBe(false);
    const phaseFlip = store.recompute(46 * 60_000); // → closing
    expect(phaseFlip.changed).toBe(true);
  });
});
