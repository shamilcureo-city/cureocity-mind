import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  push: vi.fn(),
  finished: vi.fn(),
  clear: vi.fn(async () => {}),
  recorder: {
    state: 'recording',
    error: null,
    lastChunkIndex: 0,
    pendingCount: 0,
    draining: false,
    startedAt: 100,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    drainPending: vi.fn(async () => 0),
  },
}));

// Execute the real component's rendered handlers with deterministic hook state.
// Browser capture/HTTP are boundaries; recorder internals have separate adapter tests.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => {},
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (value: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof value === 'function'
            ? (value as (previous: T) => T)(harness.states[index] as T)
            : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock('@/lib/audio/use-session-recorder', () => ({ useSessionRecorder: () => harness.recorder }));
vi.mock('@/lib/audio/use-wake-lock', () => ({ useWakeLock: () => {} }));
vi.mock('@/lib/audio/idb-chunk-store', () => ({ SessionStore: { clear: harness.clear } }));
vi.mock('@cureocity/audio', () => ({
  flushPendingWithRetries: (drain: () => Promise<number>) => drain(),
}));
vi.mock('../components/app/InRoomDirection', () => ({ InRoomDirection: () => null }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/ui/Badge', () => ({ Badge: 'span' }));
import { LiveRecorder } from '../components/app/LiveRecorder';

type ElementProps = { children?: ReactNode; onClick?: () => void; disabled?: boolean };
function elements(node: ReactNode): Array<ReactElement<ElementProps>> {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child) ? text(child.props.children) : String(child),
    )
    .join('');
}
function render() {
  harness.stateIndex = 0;
  harness.refIndex = 0;
  return LiveRecorder({
    sessionId: 's-1',
    clientName: 'Fictional client',
    modality: null,
    source: 'mic',
    onFinished: harness.finished,
  });
}
function click(label: string) {
  const button = elements(render()).find(
    (el) => el.type === 'button' && text(el.props.children) === label,
  );
  expect(button, `Missing action: ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  button!.props.onClick!();
}
function confirmEnd() {
  click('End session');
  click('End & save');
}

beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.recorder.stop.mockResolvedValue(undefined);
  harness.recorder.drainPending.mockResolvedValue(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('real LiveRecorder finish/recovery action wiring', () => {
  it('failed final storage offers retry but no navigation that discards the in-memory tail', async () => {
    harness.recorder.stop.mockRejectedValue(new Error('Browser storage is full'));
    confirmEnd();
    await vi.waitFor(() => expect(text(render())).toContain('Browser storage is full'));
    expect(text(render())).not.toContain('Return to Today');
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();
    harness.recorder.stop.mockResolvedValue(undefined);
    click('Retry finalization');
    await vi.waitFor(() => expect(harness.push).toHaveBeenCalledWith('/app/sessions/s-1'));
    expect(harness.recorder.start).not.toHaveBeenCalled();
    expect(harness.recorder.drainPending).toHaveBeenCalledWith(true);
  });

  it('remaining uploads cannot produce an unmarked partial note or clear the resume cursor', async () => {
    harness.recorder.drainPending.mockResolvedValue(2);
    confirmEnd();
    await vi.waitFor(() => expect(text(render())).toContain('Note generation is paused'));
    expect(text(render())).not.toContain('End anyway');
    expect(text(render())).not.toContain('Return to Today');
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
    harness.recorder.drainPending.mockResolvedValue(0);
    click('Retry upload');
    await vi.waitFor(() => expect(harness.push).toHaveBeenCalledOnce());
    expect(harness.recorder.start).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/sessions/s-1/end',
      '/api/v1/sessions/s-1/generate-note',
    ]);
  });

  it('a refused end request cannot navigate, generate or erase the resume cursor', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"error":"Session cannot finish"}', { status: 409 }),
    );
    confirmEnd();
    await vi.waitFor(() => expect(text(render())).toContain('Session cannot finish'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(harness.clear).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();
    expect(text(render())).not.toContain('Return to Today');
  });
});
