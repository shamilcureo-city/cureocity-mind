import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  effects: [] as Array<() => (() => void) | void>,
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
    pause: vi.fn(async () => {}),
    drainPending: vi.fn(async () => 0),
  },
}));

// Execute the real component's rendered handlers with deterministic hook state.
// Browser capture/HTTP are boundaries; recorder internals have separate adapter tests.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: (effect: () => (() => void) | void) => {
    harness.effects.push(effect);
  },
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
vi.mock('@/lib/use-capture-view-clock', () => ({ useCaptureViewClock: () => 0 }));
vi.mock('@/lib/use-modal-a11y', () => ({ useModalA11y: () => {} }));
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
    clientId: 'c-1',
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
  harness.effects = [];
  harness.recorder.state = 'recording';
  harness.recorder.pause.mockResolvedValue(undefined);
  harness.recorder.stop.mockResolvedValue(undefined);
  harness.recorder.drainPending.mockResolvedValue(0);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('real LiveRecorder finish/recovery action wiring', () => {
  it('pause neither ends nor clears the cursor, and resume checks current authority before capture', async () => {
    click('Pause recording');
    await vi.waitFor(() => expect(harness.recorder.pause).toHaveBeenCalledOnce());
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
    harness.recorder.state = 'paused';
    expect(text(render())).toContain('Microphone off');
    let authorize!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          authorize = resolve;
        }),
    );
    click('Resume recording');
    expect(fetch).toHaveBeenCalledWith('/api/v1/sessions/s-1/capture-resume', { method: 'POST' });
    expect(harness.recorder.start).not.toHaveBeenCalled();
    authorize(new Response('{"authorized":true}'));
    await vi.waitFor(() => expect(harness.recorder.start).toHaveBeenCalledOnce());
    expect(harness.clear).not.toHaveBeenCalled();
  });

  it('withdrawn consent keeps a paused recording off and shows the refusal', async () => {
    harness.recorder.state = 'paused';
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"error":"Recording consent is required"}', { status: 409 }),
    );
    click('Resume recording');
    await vi.waitFor(() => expect(text(render())).toContain('Recording consent is required'));
    expect(harness.recorder.start).not.toHaveBeenCalled();
    expect(harness.clear).not.toHaveBeenCalled();
  });

  it('unmount during resume authorization never reopens the microphone from the late response', async () => {
    harness.recorder.state = 'paused';
    render();
    const unmount = harness.effects[0]();
    let authorize!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          authorize = resolve;
        }),
    );
    click('Resume recording');
    unmount?.();
    authorize(new Response('{"authorized":true}'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.recorder.start).not.toHaveBeenCalled();
  });

  it('End from a pause still uses the explicit stop/upload/end path without reopening capture', async () => {
    harness.recorder.state = 'paused';
    confirmEnd();
    await vi.waitFor(() => expect(harness.push).toHaveBeenCalledOnce());
    expect(harness.recorder.start).not.toHaveBeenCalled();
    expect(harness.recorder.stop).toHaveBeenCalledOnce();
  });
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
