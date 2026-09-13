import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactNode, type ReactElement } from 'react';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  effectIndex: 0,
  fetch: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T) => {
    const index = h.stateIndex++;
    if (!(index in h.states)) h.states[index] = initial;
    return [
      h.states[index],
      (value: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (previous: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
import { SessionUsagePanel, SessionUsageDetails } from '../components/app/SessionUsagePanel';
const summary = (sessionId = 'visit-1') => ({
  version: 1,
  sessionId,
  recordedSubtotalInr: '2.2700',
  liveConnectionSubtotalInr: '2.0000',
  webCallSubtotalInr: '0.2700',
  legacySubtotalInr: null,
  lowerBound: false,
  coverage: 'PARTIAL',
  coverageReasons: [],
  connections: { registered: 2, receipted: 2, open: 0, finalReported: 2, incomplete: 0 },
  webCallRecords: 1,
  legacyOverlap: 'NONE',
  usageBasis: 'RECORDED_ESTIMATE',
  reconciliation: 'NOT_RECONCILED',
});
type Props = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  summary?: ReturnType<typeof summary>;
  stale?: boolean;
};
const all = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...all(child.props.children)] : [],
  );
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
let visit = 'visit-1';
function render(flush = true) {
  h.stateIndex = h.effectIndex = 0;
  const result = SessionUsagePanel({ sessionId: visit });
  if (flush) h.queued.splice(0).forEach((effect) => effect());
  return result;
}
const details = () => all(render()).find((node) => node.type === SessionUsageDetails);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.fetch);
  h.states = [];
  h.effects = [];
  h.queued = [];
  visit = 'visit-1';
  h.fetch.mockResolvedValue(Response.json(summary()));
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});
describe('exact-visit usage view lifecycle (hook harness)', () => {
  it('reads privately and exposes the validated exact visit only', async () => {
    render();
    await vi.waitFor(() => expect(details()?.props.summary?.sessionId).toBe('visit-1'));
    expect(h.fetch).toHaveBeenCalledWith(
      '/api/v1/sessions/visit-1/usage',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });
  it('never displays another visit while its replacement request is pending', async () => {
    render();
    await vi.waitFor(() => expect(details()).toBeDefined());
    h.fetch.mockImplementation(() => new Promise(() => {}));
    visit = 'visit-2';
    expect(all(render(false)).some((node) => node.type === SessionUsageDetails)).toBe(false);
    render();
    expect(details()).toBeUndefined();
  });
  it('rejects wrong-visit and malformed responses without manufacturing zero', async () => {
    h.fetch.mockResolvedValue(Response.json(summary('another-visit')));
    render();
    await vi.waitFor(() => expect(text(render())).toContain('estimate could not be refreshed'));
    expect(details()).toBeUndefined();
  });
  it('retains a labeled last available result after refresh failure and permits retry', async () => {
    render();
    await vi.waitFor(() => expect(details()).toBeDefined());
    h.fetch.mockRejectedValue(new Error('network'));
    all(render()).find((node) => node.type === 'button')!.props.onClick!();
    render();
    await vi.waitFor(() => expect(details()?.props.stale).toBe(true));
    expect(all(render()).find((node) => node.type === 'button')?.props.disabled).toBe(false);
  });
});
