import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { Utterance } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  effects: [] as Array<() => (() => void) | void>,
  registerEffects: true,
  cleanups: [] as Array<() => void>,
  push: vi.fn(),
  sockets: [] as Socket[],
  onFrame: (_pcm: Uint8Array) => {},
  onInterrupted: (_message: string) => {},
  stream: {
    state: 'idle',
    error: null,
    inputLevel: 0,
    lastAudioAt: null as number | null,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  },
}));

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect: (effect: () => (() => void) | void) => {
    if (harness.registerEffects) harness.effects.push(effect);
  },
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (next: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof next === 'function'
            ? (next as (previous: T) => T)(harness.states[index] as T)
            : next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock('@/lib/audio/use-live-stream', () => ({
  useLiveStream: (opts: {
    onFrame: (pcm: Uint8Array) => void;
    onInterrupted: (message: string) => void;
  }) => {
    harness.onFrame = opts.onFrame;
    harness.onInterrupted = opts.onInterrupted;
    return harness.stream;
  },
}));
vi.mock('../components/app/GatewayMockBanner', () => ({ GatewayMockBanner: () => null }));
vi.mock('../components/app/ReviewAndSign', () => ({ ReviewAndSign: 'review-and-sign' }));
vi.mock('../components/app/TurnoverBar', () => ({ TurnoverBar: () => null }));
vi.mock('../components/app/ScribeLiveWorkspace', () => ({
  ScribeLiveWorkspace: 'scribe-workspace',
  ScribeInputMeter: 'input-meter',
  scribeLiveStyles: {},
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
// The component also defines JSX icons at module scope. The Node-only test
// transform uses the classic JSX runtime, so supply React before importing it.
vi.stubGlobal('React', React);
const { DoctorLiveEncounter } = await import('../components/app/DoctorLiveEncounter');

class Socket {
  static OPEN = 1;
  OPEN = 1;
  readyState = 0;
  private buffered = 0;
  get bufferedAmount() {
    return this.buffered;
  }
  set bufferedAmount(value: number) {
    this.buffered = value;
  }
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
  });
  constructor() {
    harness.sockets.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  status(state: string) {
    this.emit({ type: 'status', state });
  }
  disconnect() {
    this.readyState = 3;
    this.onclose?.();
  }
}

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  role?: string;
  transcript?: ReactElement<{ utterances: Utterance[] }>;
  captureSaveState?: string;
};
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
  const view = DoctorLiveEncounter({
    sessionId: 'session-1',
    clientId: 'client-1',
    patient: { name: 'Fictional patient', age: 30 },
  });
  harness.registerEffects = false;
  return view;
}
function mount() {
  render();
  harness.cleanups = harness.effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
}
function action(label: string) {
  return elements(render()).find(
    (element) => element.type === 'button' && text(element.props.children) === label,
  );
}
function click(label: string) {
  const button = action(label);
  expect(button, `Missing action: ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  button!.props.onClick!();
}
function displayedUtterances() {
  return elements(render()).find((element) => element.type === 'scribe-workspace')?.props.transcript
    ?.props.utterances;
}
function commands(socket: Socket) {
  return socket.send.mock.calls.flatMap(([payload]) =>
    typeof payload === 'string' ? [JSON.parse(payload) as Record<string, unknown>] : [],
  );
}
function savedDrafts() {
  return vi
    .mocked(fetch)
    .mock.calls.flatMap(([url, init]) =>
      String(url).endsWith('/live-note')
        ? [JSON.parse(init!.body as string) as Record<string, unknown>]
        : [],
    );
}
function deferredStop() {
  let resolve!: () => void;
  harness.stream.stop.mockImplementationOnce(() => {
    harness.stream.state = 'idle';
    return new Promise<void>((done) => {
      resolve = done;
    });
  });
  return () => resolve();
}

const utterance: Utterance = {
  id: 'u1',
  speaker: 'patient',
  text: 'I have had a cough for two days.',
  tStartMs: 0,
  tEndMs: 3_000,
};

async function startCapture() {
  mount();
  click('● Start live consult');
  await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
  const socket = harness.sockets[0];
  expect(harness.stream.start).not.toHaveBeenCalled();
  socket.open();
  expect(harness.stream.start).not.toHaveBeenCalled();
  socket.status('listening');
  expect(harness.stream.start).toHaveBeenCalledOnce();
  render();
  return socket;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.cleanups = [];
  harness.sockets = [];
  harness.registerEffects = true;
  harness.stream.state = 'idle';
  harness.stream.start.mockImplementation(async () => {
    harness.stream.state = 'streaming';
  });
  harness.stream.stop.mockImplementation(async () => {
    harness.stream.state = 'idle';
  });
  vi.stubGlobal('React', React);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', { location: { protocol: 'http:' } });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response('{"token":"fixture-token","expiresInSec":300}', { status: 200 }),
    ),
  );
});
afterEach(() => {
  harness.cleanups.forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Scribe live consultation lifecycle', () => {
  it('leaves recording after microphone interruption and preserves words through explicit authorized resume', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    expect(displayedUtterances()).toEqual([utterance]);
    harness.onInterrupted('The microphone disconnected.');
    expect(text(render())).toContain('Capture stopped · microphone off');
    expect(action('Pause recording')).toBeUndefined();
    expect(displayedUtterances()).toEqual([utterance]);
    expect(harness.stream.stop).toHaveBeenCalledOnce();
    expect(socket.close).toHaveBeenCalledOnce();

    click('Resume recording');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    const resumed = harness.sockets[1];
    expect(harness.stream.start).toHaveBeenCalledOnce();
    resumed.open();
    expect(commands(resumed)[0]).toMatchObject({
      type: 'start',
      resume: { utterances: [utterance] },
    });
    expect(harness.stream.start).toHaveBeenCalledOnce();
    socket.status('listening');
    expect(harness.stream.start).toHaveBeenCalledOnce();
    resumed.status('listening');
    expect(harness.stream.start).toHaveBeenCalledTimes(2);
    expect(displayedUtterances()).toEqual([utterance]);
    expect(text(render())).toContain('Some words may be missing.');
  });

  it('drains microphone tail before requesting pause and waits for the matching acknowledgement', async () => {
    const socket = await startCapture();
    const finishStop = deferredStop();
    click('Pause recording');
    expect(text(render())).toContain('Mic off · confirming last words');
    expect(commands(socket).some(({ type }) => type === 'pause')).toBe(false);
    const tail = new Uint8Array([1, 2, 3, 4]);
    harness.onFrame(tail);
    expect(socket.send).toHaveBeenLastCalledWith(tail);
    finishStop();
    await vi.waitFor(() =>
      expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
    );
    const request = commands(socket).find(({ type }) => type === 'pause')!;
    expect(socket.send.mock.calls.findIndex(([payload]) => payload === tail)).toBeLessThan(
      socket.send.mock.calls.findIndex(
        ([payload]) => typeof payload === 'string' && JSON.parse(payload).type === 'pause',
      ),
    );
    socket.emit({ type: 'capturePaused', requestId: '00000000-0000-4000-8000-000000000001' });
    expect(action('Resume recording')).toBeUndefined();
    socket.emit({ type: 'capturePaused', requestId: request.requestId });
    await vi.waitFor(() => expect(action('Resume recording')).toBeDefined());
    expect(text(render())).toContain('Paused · microphone off');
    expect(savedDrafts()).toEqual([]);
  });

  it('awaits microphone tail and socket delivery before sending End', async () => {
    const socket = await startCapture();
    const finishStop = deferredStop();
    click('End & review note');
    expect(text(render())).toContain('Finishing · microphone off');
    expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    const tail = new Uint8Array([5, 6, 7, 8]);
    harness.onFrame(tail);
    expect(socket.send).toHaveBeenLastCalledWith(tail);
    socket.bufferedAmount = 10;
    const bufferedRead = vi.spyOn(socket, 'bufferedAmount', 'get');
    finishStop();
    await vi.waitFor(() => expect(bufferedRead).toHaveBeenCalled());
    expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    socket.bufferedAmount = 0;
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'stop' }));
  });

  it('does not abandon finalization when a pending microphone start is cancelled by End', async () => {
    let rejectStart!: (error: Error) => void;
    const pendingStart = new Promise<void>((_resolve, reject) => {
      rejectStart = reject;
    });
    harness.stream.start.mockImplementationOnce(() => {
      harness.stream.state = 'preparing';
      return pendingStart;
    });
    const socket = await startCapture();
    expect(text(render())).toContain('Starting microphone…');
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));

    rejectStart(new Error('Capture start was cancelled.'));
    await pendingStart.catch(() => {});
    expect(text(render())).toContain('Finishing · microphone off');
    expect(action('Resume recording')).toBeUndefined();
    expect(socket.close).not.toHaveBeenCalled();
    expect(harness.stream.stop).toHaveBeenCalledOnce();
    expect(savedDrafts()).toEqual([]);
  });

  it('saves an incomplete draft instead of sending End when the final captured frame is unconfirmed', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    socket.emit({ type: 'note', partial: { chiefComplaint: 'Cough', hpi: 'Cough for two days.' } });
    render();
    harness.stream.stop.mockRejectedValue(new Error('The final audio frame was not confirmed.'));
    click('End & review note');
    await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
    expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    expect(savedDrafts()[0]).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'audio_loss',
      transcript: 'Patient: I have had a cough for two days.',
      note: { chiefComplaint: 'Cough', hpi: 'Cough for two days.' },
    });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });

  it('exits the confirming-pause state if the connection closes before the acknowledgement', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    click('Pause recording');
    await vi.waitFor(() =>
      expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
    );
    socket.disconnect();
    await vi.waitFor(() => expect(action('Resume recording')).toBeDefined());
    expect(action('Confirming pause…')).toBeUndefined();
    expect(text(render())).toContain('Some words may be missing.');
    expect(displayedUtterances()).toEqual([utterance]);
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });

  it('stops safely if the connection closes while microphone tail is still draining for Pause', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    const finishStop = deferredStop();
    click('Pause recording');
    socket.disconnect();
    finishStop();
    await vi.waitFor(() => expect(action('Resume recording')).toBeDefined());
    expect(commands(socket).some(({ type }) => type === 'pause')).toBe(false);
    expect(action('Confirming pause…')).toBeUndefined();
    expect(displayedUtterances()).toEqual([utterance]);
    expect(text(render())).toContain('Some words may be missing.');
  });

  it.each(['listening', 'pausing'])(
    'keeps a gateway-initiated final note incomplete while %s',
    async (phase) => {
      const socket = await startCapture();
      socket.emit({ type: 'utterance', utterance });
      if (phase === 'pausing') {
        click('Pause recording');
        await vi.waitFor(() =>
          expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
        );
      }
      socket.status('finalizing');
      render();
      socket.emit({
        type: 'final',
        note: {
          version: 'V1',
          encounterKind: 'NEW_OPD',
          chiefComplaint: 'Cough',
          hpi: 'Cough for two days.',
          reviewOfSystems: [],
          physicalExam: { examined: false, findings: '' },
          vitals: {},
          assessment: '',
          plan: '',
          linkedEvidence: [],
        },
      });
      await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
      expect(savedDrafts()[0]).toMatchObject({ captureIncomplete: true });
      expect(harness.stream.stop).toHaveBeenCalled();
      expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    },
  );
});
