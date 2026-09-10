import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto, randomUUID } from 'node:crypto';
import type { TherapyReasoningV1 } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
}));
vi.mock('react', () => ({
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T | ((old: T) => T)) => {
        harness.states[index] =
          typeof value === 'function'
            ? (value as (old: T) => T)(harness.states[index] as T)
            : value;
      },
    ];
  },
  useRef: <T>(value: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current: value });
  },
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = harness.effectIndex++;
    const previous = harness.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i])) {
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
    }
  },
}));
import { useMindCueReview } from './use-mind-cue-review';
import { cueFingerprints, cueReviewKey } from './mind-cue-review';

let reasoning: TherapyReasoningV1;
let sessionId = 's1';
const cueId = 'risk-live-fixture';
const cueKey = cueReviewKey('RED_FLAG', cueId);
const operationId = '0d9c2c4e-0434-4810-9f12-cb2e07c54c00';
const updatedAt = '2026-09-09T10:00:00.000Z';
function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
  const result = useMindCueReview(sessionId, reasoning);
  const effects = harness.queued.splice(0);
  effects.forEach((run) => run());
  return result;
}
async function loaded() {
  render();
  await vi.waitFor(() => expect(render().loaded).toBe(true));
  await cueFingerprints(reasoning);
  await new Promise((resolve) => setTimeout(resolve, 0));
}
beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  sessionId = 's1';
  vi.stubGlobal('crypto', { subtle: webcrypto.subtle, randomUUID });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  reasoning = {
    version: 1,
    arc: null,
    askNext: [],
    threads: [],
    riskWatch: [
      {
        id: cueId,
        label: 'Fictional cue',
        why: 'Fictional evidence',
        source: 'LIVE',
        severity: 'high',
        sourceUtteranceIds: ['u1'],
      },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      if (init?.method === 'POST') {
        const { expectedRevision: _expected, ...input } = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...input, updatedAt }));
      }
      return new Response('{"records":[]}');
    }),
  );
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('Mind cue review UI state through save, correction and restoration', () => {
  it('switching session during an old save clears pending UI immediately and ignores its late receipt', async () => {
    await loaded();
    let reply!: (response: Response) => void;
    let oldInput!: Record<string, unknown>;
    vi.mocked(fetch).mockImplementationOnce((_url, init) => {
      oldInput = JSON.parse(String(init?.body));
      return new Promise((resolve) => {
        reply = resolve;
      });
    });
    render().review(cueId, 'RED_FLAG', 'reviewed');
    expect(render().pendingId).toBe(cueId);
    sessionId = 's2';
    const switched = render();
    expect(switched.pendingId).toBeNull();
    expect(switched.records).toEqual([]);
    expect(switched.resolvedIds.size).toBe(0);
    expect(switched.loaded).toBe(false);
    expect(switched.blocked).toBe(true);
    await vi.waitFor(() => expect(render().loaded).toBe(true));
    const { expectedRevision: _oldRevision, ...oldReceipt } = oldInput;
    reply(new Response(JSON.stringify({ ...oldReceipt, updatedAt })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().pendingId).toBeNull();
    expect(render().records).toEqual([]);
    expect(render().blocked).toBe(false);
    render().review(cueId, 'RED_FLAG', 'reviewed');
    await vi.waitFor(() => expect(render().resolvedIds.has(cueKey)).toBe(true));
    expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/v1/sessions/s2/mind-cue-review');
  });
  it('keeps a cue visible while saving and after failure, then retries the exact operation', async () => {
    await loaded();
    let reply!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    render().review(cueId, 'RED_FLAG', 'reviewed');
    expect(render().pendingId).toBe(cueId);
    expect(render().resolvedIds.size).toBe(0);
    reply(new Response('{}', { status: 500 }));
    await vi.waitFor(() => expect(render().error).toContain('could not be confirmed'));
    expect(render().resolvedIds.size).toBe(0);
    const attempted = vi.mocked(fetch).mock.calls.at(-1)![1]?.body;
    render().retry();
    await vi.waitFor(() => expect(render().resolvedIds.has(cueKey)).toBe(true));
    expect(vi.mocked(fetch).mock.calls.at(-1)![1]?.body).toBe(attempted);
  });

  it('Undo is also acknowledged; a failed correction stays in reviewed history until retry confirms', async () => {
    await loaded();
    render().review(cueId, 'RED_FLAG', 'reviewed');
    await vi.waitFor(() => expect(render().resolvedIds.has(cueKey)).toBe(true));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    render().review(cueId, 'RED_FLAG', 'reopened');
    await vi.waitFor(() => expect(render().error).not.toBeNull());
    expect(render().records[0]?.state).toBe('reviewed');
    render().retry();
    await vi.waitFor(() => expect(render().records[0]?.state).toBe('reopened'));
    expect(render().resolvedIds.size).toBe(0);
  });

  it('restores only matching reviewed evidence after reopening, and never revives missing gateway cues', async () => {
    const fingerprint = (await cueFingerprints(reasoning))[cueKey];
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: [
            { id: cueId, kind: 'RED_FLAG', state: 'reviewed', fingerprint, operationId, updatedAt },
          ],
        }),
      ),
    );
    await loaded();
    await vi.waitFor(() => expect(render().resolvedIds.has(cueKey)).toBe(true));
    reasoning = {
      ...reasoning,
      riskWatch: [{ ...reasoning.riskWatch[0]!, sourceUtteranceIds: ['u1', 'new-evidence'] }],
    };
    expect(render().resolvedIds.size).toBe(0);
    await cueFingerprints(reasoning);
    expect(render().resolvedIds.size).toBe(0);
    reasoning = { ...reasoning, riskWatch: [] };
    expect(render().resolvedIds.size).toBe(0);
    expect(render().records).toHaveLength(1);
  });

  it('a failed or malformed history load cannot hide safety or accept new review marks', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 500 }));
    render();
    await vi.waitFor(() => expect(render().error).toContain('history could not be loaded'));
    const calls = vi.mocked(fetch).mock.calls.length;
    render().review(cueId, 'RED_FLAG', 'reviewed');
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(render().resolvedIds.size).toBe(0);
    render().retry();
    await vi.waitFor(() => expect(render().loaded).toBe(true));
  });
});
