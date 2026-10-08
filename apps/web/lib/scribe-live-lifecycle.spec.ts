import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { MedicalEncounterNoteV1, MeterSummary, Utterance } from '@cureocity/contracts';

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
  checkpointLoad: vi.fn(),
  checkpointAppend: vi.fn(),
  checkpointFailure: () => {},
  selectedDeviceId: undefined as string | undefined,
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
    selectedDeviceId?: string;
  }) => {
    harness.onFrame = opts.onFrame;
    harness.onInterrupted = opts.onInterrupted;
    harness.selectedDeviceId = opts.selectedDeviceId;
    return harness.stream;
  },
}));
// Ordered/encrypted checkpoint I/O has its own route/controller tests. These
// lifecycle tests isolate socket and microphone ownership from that transport.
vi.mock('@/lib/scribe-capture-recovery', () => ({
  ScribeCaptureCheckpoint: class {
    constructor(private options: { onState: (state: string) => void; onFailure: () => void }) {
      harness.checkpointFailure = () => {
        options.onState('error');
        options.onFailure();
      };
    }
    async load() {
      const recovery = await harness.checkpointLoad();
      this.options.onState(recovery ? 'saved' : 'ready');
      return recovery;
    }
    async append(input: unknown) {
      await harness.checkpointAppend(input);
      this.options.onState('saved');
    }
    async flush() {}
    close() {}
  },
}));
vi.mock('../components/app/GatewayMockBanner', () => ({ GatewayMockBanner: () => null }));
vi.mock('../components/app/ReviewAndSign', () => ({ ReviewAndSign: 'review-and-sign' }));
vi.mock('../components/app/TurnoverBar', () => ({ TurnoverBar: () => null }));
vi.mock('../components/app/ScribeMicrophoneDialog', () => ({
  ScribeMicrophoneDialog: 'microphone-dialog',
}));
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
let teleconsult: Parameters<typeof DoctorLiveEncounter>[0]['teleconsult'];

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
  onContinue?: (deviceId: string) => void;
  onCancel?: () => void;
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
    teleconsult,
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
function microphoneDialog() {
  return elements(render()).find((element) => element.type === 'microphone-dialog');
}
function confirmMicrophone() {
  const dialog = microphoneDialog();
  expect(dialog, 'Microphone check must precede clinical capture').toBeDefined();
  dialog!.props.onContinue!('checked-microphone');
  render();
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
const completedNote: MedicalEncounterNoteV1 = {
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
};
const finalMeter: MeterSummary = {
  sessionId: 'session-1',
  backend: 'mock',
  windows: 1,
  pass1Calls: 1,
  pass2Calls: 1,
  inputTokens: 30,
  outputTokens: 20,
  costInr: 0,
  transcriptP50Ms: 100,
  transcriptP95Ms: 100,
  speechToTranscriptP50Ms: 200,
  speechToTranscriptP95Ms: 200,
  noteP50Ms: 100,
  noteP95Ms: 100,
  elapsedMs: 5_000,
};
function savedMeters() {
  return vi
    .mocked(fetch)
    .mock.calls.flatMap(([url, init]) =>
      String(url).endsWith('/live-metric') ? [JSON.parse(init!.body as string)] : [],
    );
}
function hasReview() {
  return elements(render()).some((node) => node.type === 'review-and-sign');
}

async function startCapture() {
  mount();
  click('● Start live consult');
  expect(fetch).not.toHaveBeenCalled();
  expect(harness.stream.start).not.toHaveBeenCalled();
  confirmMicrophone();
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
  teleconsult = undefined;
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.cleanups = [];
  harness.sockets = [];
  harness.registerEffects = true;
  harness.stream.state = 'idle';
  harness.selectedDeviceId = undefined;
  harness.checkpointLoad.mockResolvedValue(null);
  harness.checkpointAppend.mockResolvedValue(undefined);
  harness.stream.start.mockImplementation(async () => {
    harness.stream.state = 'streaming';
  });
  harness.stream.stop.mockImplementation(async () => {
    harness.stream.state = 'idle';
  });
  vi.stubGlobal('React', React);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', {
    location: { protocol: 'http:' },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    confirm: vi.fn(() => false),
    navigation: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
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
  it('restores securely acknowledged words without opening a microphone and salvages them on End', async () => {
    harness.checkpointLoad.mockResolvedValue({
      version: 1,
      utterances: [utterance],
      captureIncomplete: false,
    });
    mount();
    await vi.waitFor(() => expect(displayedUtterances()).toEqual([utterance]));
    expect(harness.stream.start).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);
    expect(text(render())).toContain('Recovered the last securely saved');
    click('End & review note');
    await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
    expect(savedDrafts()[0]).toMatchObject({
      transcript: 'Patient: I have had a cough for two days.',
      captureIncomplete: true,
    });
  });
  it('stops input on checkpoint failure while retaining captured source for incomplete final recovery', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    expect(harness.checkpointAppend).toHaveBeenCalledWith(
      expect.objectContaining({ utterances: [utterance] }),
    );
    harness.checkpointFailure();
    expect(harness.stream.stop).toHaveBeenCalled();
    expect(displayedUtterances()).toEqual([utterance]);
    const sent = socket.send.mock.calls.length;
    harness.onFrame(new Uint8Array([2, 3]));
    expect(socket.send.mock.calls.length).toBe(sent);
    click('End & review note');
    await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
    expect(savedDrafts()[0]).toMatchObject({
      transcript: 'Patient: I have had a cough for two days.',
      captureIncomplete: true,
    });
  });
  it('opens readiness without capture or session requests and allows cancellation', () => {
    mount();
    click('● Start live consult');
    expect(microphoneDialog()).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);
    expect(harness.stream.start).not.toHaveBeenCalled();
    microphoneDialog()!.props.onCancel!();
    expect(microphoneDialog()).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the checked microphone only after explicit readiness confirmation', async () => {
    await startCapture();
    expect(harness.selectedDeviceId).toBe('checked-microphone');
    expect(microphoneDialog()).toBeUndefined();
  });
  it('does not label a consent or session conflict as a saved draft', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    socket.emit({ type: 'note', partial: { chiefComplaint: 'Cough' } });
    vi.mocked(fetch).mockImplementation(async (url) =>
      String(url).endsWith('/live-note')
        ? Response.json({ error: 'Consent changed.' }, { status: 409 })
        : Response.json({ token: 'fixture-token', expiresInSec: 300 }),
    );
    harness.onInterrupted('Capture interrupted.');
    click('Review captured note');
    await vi.waitFor(() =>
      expect(text(render())).toContain('Draft not saved. Retry saving before review or signing.'),
    );
    expect(elements(render()).some((node) => node.type === 'review-and-sign')).toBe(false);
    expect(action('Retry saving draft')).toBeDefined();
  });
  it('does not mint or open capture when a teleconsult lacks consent or either audio source', () => {
    teleconsult = {
      stream: null,
      ready: false,
      unavailableReason: 'Patient consent is pending.',
      beforeStart: vi.fn(),
      onStateChange: vi.fn(),
    };
    mount();
    expect(action('Start AI documentation')?.props.disabled).toBe(true);
    expect(text(render())).toContain('Patient consent is pending.');
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  it('requires server consent confirmation before minting a teleconsult live token', async () => {
    const authorize = vi.fn(async () => {
      throw new Error('Patient withdrew AI consent.');
    });
    teleconsult = {
      stream: {} as MediaStream,
      ready: true,
      unavailableReason: null,
      beforeStart: authorize,
      onStateChange: vi.fn(),
    };
    mount();
    click('Start AI documentation');
    expect(microphoneDialog()).toBeUndefined();
    await vi.waitFor(() => expect(text(render())).toContain('Patient withdrew AI consent.'));
    expect(authorize).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  it('stops sending video frames as soon as consent/readiness changes and requires explicit resume', async () => {
    teleconsult = {
      stream: {} as MediaStream,
      ready: true,
      unavailableReason: null,
      beforeStart: vi.fn(async () => {}),
      onStateChange: vi.fn(),
    };
    mount();
    click('Start AI documentation');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    socket.status('listening');
    render();
    const first = new Uint8Array([1, 2]);
    harness.onFrame(first);
    expect(socket.send).toHaveBeenLastCalledWith(first);
    teleconsult = { ...teleconsult, ready: false, unavailableReason: 'Patient withdrew consent.' };
    render();
    const later = new Uint8Array([3, 4]);
    harness.onFrame(later);
    expect(socket.send).not.toHaveBeenCalledWith(later);
    harness.onInterrupted('Call capture is no longer authorized.');
    expect(action('Resume AI documentation')?.props.disabled).toBe(true);
    expect(text(render())).toContain('Some words may be missing.');
    expect(harness.stream.stop).toHaveBeenCalledOnce();
  });
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
    expect(harness.sockets).toHaveLength(1);
    expect(displayedUtterances()).toEqual([utterance]);
    confirmMicrophone();
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

  it('does not renew capture during a deliberate teleconsult pause and resumes with a fresh authorization', async () => {
    vi.useFakeTimers();
    teleconsult = {
      stream: {} as MediaStream,
      ready: true,
      unavailableReason: null,
      beforeStart: vi.fn(async () => {}),
      onStateChange: vi.fn(),
    };
    mount();
    click('Start AI documentation');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    socket.status('listening');
    socket.emit({ type: 'utterance', utterance });
    render();
    click('Pause AI documentation');
    await vi.waitFor(() =>
      expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
    );
    const pause = commands(socket).find(({ type }) => type === 'pause')!;
    socket.emit({ type: 'capturePaused', requestId: pause.requestId });
    await vi.waitFor(() => expect(action('Resume AI documentation')).toBeDefined());

    await vi.advanceTimersByTimeAsync(310_000);
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/live-token')),
    ).toHaveLength(1);
    expect(commands(socket).some(({ type }) => type === 'renewToken')).toBe(false);
    expect(text(render())).not.toContain('Some words may be missing.');
    expect(displayedUtterances()).toEqual([utterance]);
    expect(harness.stream.start).toHaveBeenCalledOnce();

    // A paused socket may expire; that is not permission to silently resume.
    socket.status('unauthorized');
    socket.disconnect();
    expect(text(render())).not.toContain('Some words may be missing.');
    click('Resume AI documentation');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    expect(teleconsult.beforeStart).toHaveBeenCalledTimes(2);
    const resumed = harness.sockets[1];
    resumed.open();
    expect(commands(resumed)[0]).toMatchObject({
      type: 'start',
      resume: { utterances: [utterance] },
    });
    expect(harness.stream.start).toHaveBeenCalledOnce();
    resumed.status('listening');
    expect(harness.stream.start).toHaveBeenCalledTimes(2);
    expect(text(render())).not.toContain('Some words may be missing.');
  });

  it.each(['paused', 'finalizing'])(
    'immediately preserves an incomplete teleconsult draft if authorization expires while %s',
    async (phase) => {
      teleconsult = {
        stream: {} as MediaStream,
        ready: true,
        unavailableReason: null,
        beforeStart: vi.fn(async () => {}),
        onStateChange: vi.fn(),
      };
      mount();
      click('Start AI documentation');
      await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
      const socket = harness.sockets[0];
      socket.open();
      socket.status('listening');
      socket.emit({ type: 'utterance', utterance });
      socket.emit({ type: 'note', partial: { chiefComplaint: 'Cough' } });
      render();
      click('Pause AI documentation');
      await vi.waitFor(() =>
        expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
      );
      const pause = commands(socket).find(({ type }) => type === 'pause')!;
      socket.emit({ type: 'capturePaused', requestId: pause.requestId });
      await vi.waitFor(() => expect(action('Resume AI documentation')).toBeDefined());
      if (phase === 'finalizing') {
        click('End & review note');
        await vi.waitFor(() =>
          expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true),
        );
      }
      socket.status('unauthorized');
      if (phase === 'paused') click('End & review note');
      await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
      expect(savedDrafts()[0]).toMatchObject({
        captureIncomplete: true,
        transcript: 'Patient: I have had a cough for two days.',
        note: { chiefComplaint: 'Cough' },
      });
      expect(harness.stream.start).toHaveBeenCalledOnce();
      expect(socket.close).toHaveBeenCalled();
      expect(text(render())).toContain('review any missing words before signing');
    },
  );

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

  it('stops microphone and waits for a fresh correlated authorization lease before End near expiry', async () => {
    vi.useFakeTimers();
    const socket = await startCapture();
    // A suspended/background event loop can delay the proactive renewal timer.
    vi.setSystemTime(Date.now() + 220_000);
    click('End & review note');
    await vi.waitFor(() =>
      expect(commands(socket).some(({ type }) => type === 'renewToken')).toBe(true),
    );
    expect(harness.stream.stop).toHaveBeenCalledOnce();
    expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    const renew = commands(socket).find(({ type }) => type === 'renewToken')!;
    socket.emit({
      type: 'tokenRenewed',
      requestId: renew.requestId,
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    });
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });
  it('salvages captured words with an incomplete warning when finalization renewal is denied', async () => {
    vi.useFakeTimers();
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    vi.setSystemTime(Date.now() + 220_000);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Denied' }, { status: 403 }));
    click('End & review note');
    await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
    expect(savedDrafts()[0]).toMatchObject({
      transcript: 'Patient: I have had a cough for two days.',
      captureIncomplete: true,
    });
    expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    expect(harness.stream.start).toHaveBeenCalledOnce();
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
      socket.status('done');
      await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
      expect(savedDrafts()[0]).toMatchObject({ captureIncomplete: true });
      expect(harness.stream.stop).toHaveBeenCalled();
      expect(commands(socket).some(({ type }) => type === 'stop')).toBe(false);
    },
  );

  it('drains the terminal meter, closes live ownership, then saves the note exactly once', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    socket.emit({ type: 'meter', summary: { ...finalMeter, pass2Calls: 0 } });
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    const regularFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/live-note')) expect(socket.close).toHaveBeenCalledOnce();
      return regularFetch(url, init);
    });

    socket.emit({ type: 'final', note: completedNote });
    expect(savedDrafts()).toEqual([]);
    expect(savedMeters()).toEqual([]);
    expect(socket.close).not.toHaveBeenCalled();
    expect(action('New consult')?.props.disabled).toBe(true);
    socket.status('unauthorized');
    socket.status('listening');
    socket.emit({ type: 'final', note: { ...completedNote, chiefComplaint: 'Duplicate' } });
    socket.emit({ type: 'utterance', utterance: { ...utterance, id: 'late', text: 'Late text.' } });
    socket.emit({ type: 'meter', summary: finalMeter });
    socket.status('done');
    await vi.waitFor(() => expect(hasReview()).toBe(true));
    expect(savedDrafts()).toHaveLength(1);
    expect(savedDrafts()[0]).toMatchObject({
      note: completedNote,
      transcript: 'Patient: I have had a cough for two days.',
    });
    expect(savedDrafts()[0]).not.toHaveProperty('captureIncomplete');
    expect(savedMeters()).toEqual([finalMeter]);
    expect(text(render())).toContain('Consultation ended');
    expect(text(render())).not.toContain('could not be authorised');
    expect(action('Resume recording')).toBeUndefined();
    expect(action('New consult')?.props.disabled).toBe(false);

    // Closed or already-queued callbacks cannot rewrite the accepted result.
    socket.status('unauthorized');
    socket.status('done');
    socket.emit({ type: 'final', note: completedNote });
    socket.emit({ type: 'meter', summary: { ...finalMeter, pass2Calls: 99 } });
    socket.disconnect();
    harness.onInterrupted('Late microphone stop callback.');
    expect(savedDrafts()).toHaveLength(1);
    expect(savedMeters()).toEqual([finalMeter]);
    expect(harness.stream.start).toHaveBeenCalledOnce();
    expect(text(render())).not.toContain('could not be authorised');
  });

  it('preserves an accepted final on transport close without substituting an interim meter', async () => {
    const socket = await startCapture();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.emit({ type: 'meter', summary: { ...finalMeter, pass2Calls: 0 } });
    socket.emit({ type: 'final', note: completedNote });
    socket.disconnect();
    await vi.waitFor(() => expect(hasReview()).toBe(true));
    expect(savedDrafts()).toHaveLength(1);
    expect(savedMeters()).toEqual([]);
    expect(text(render())).toContain('Consultation ended');
    expect(text(render())).not.toContain('connection dropped');
  });

  it('retires socket ownership and saves an accepted final if the component unmounts during drain', async () => {
    const socket = await startCapture();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.emit({ type: 'final', note: completedNote });
    socket.emit({ type: 'meter', summary: finalMeter });
    expect(savedDrafts()).toHaveLength(0);
    const regularFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/live-note')) expect(socket.close).toHaveBeenCalledOnce();
      return regularFetch(url, init);
    });
    harness.cleanups.forEach((cleanup) => cleanup());
    harness.cleanups = [];
    await vi.waitFor(() => expect(savedMeters()).toEqual([finalMeter]));
    expect(savedDrafts()).toHaveLength(1);
    socket.status('done');
    socket.status('unauthorized');
    expect(savedDrafts()).toHaveLength(1);
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it('warns before leaving while final drain or a failed save holds the only draft', async () => {
    const socket = await startCapture();
    const listener = vi
      .mocked(window.addEventListener)
      .mock.calls.find(([type]) => type === 'beforeunload')![1] as (
      event: BeforeUnloadEvent,
    ) => void;
    const beforeUnload = () => {
      const event = { preventDefault: vi.fn(), returnValue: undefined };
      listener(event as unknown as BeforeUnloadEvent);
      return event;
    };
    expect(beforeUnload().preventDefault).toHaveBeenCalledOnce();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.emit({ type: 'final', note: completedNote });
    expect(beforeUnload().preventDefault).toHaveBeenCalledOnce();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Unavailable' }, { status: 503 }),
    );
    socket.status('done');
    await vi.waitFor(() => expect(action('Retry saving draft')).toBeDefined());
    expect(beforeUnload().preventDefault).toHaveBeenCalledOnce();
    click('Retry saving draft');
    await vi.waitFor(() => expect(hasReview()).toBe(true));
    expect(beforeUnload().preventDefault).not.toHaveBeenCalled();
  });

  it('protects paused capture from sidebar and history navigation and binds explicit leave to one destination', async () => {
    const socket = await startCapture();
    click('Pause recording');
    await vi.waitFor(() =>
      expect(commands(socket).some(({ type }) => type === 'pause')).toBe(true),
    );
    const pause = commands(socket).find(({ type }) => type === 'pause')!;
    socket.emit({ type: 'capturePaused', requestId: pause.requestId });
    await vi.waitFor(() => expect(action('Resume recording')).toBeDefined());
    class LinkTarget {
      closest() {
        return { target: '', href: 'https://scribe.example/app', hasAttribute: () => false };
      }
    }
    vi.stubGlobal('Element', LinkTarget);
    const listener = vi
      .mocked(document.addEventListener)
      .mock.calls.find(([type]) => type === 'click')![1] as (event: unknown) => void;
    const event = () => ({
      target: new LinkTarget(),
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const blocked = event();
    listener(blocked);
    expect(blocked.preventDefault).toHaveBeenCalledOnce();
    const navigation = (
      window as unknown as { navigation: { addEventListener: ReturnType<typeof vi.fn> } }
    ).navigation;
    const history = navigation.addEventListener.mock.calls[0]![1] as (event: unknown) => void;
    const navigationEvent = (url: string) => ({
      canIntercept: true,
      cancelable: true,
      destination: { url },
      preventDefault: vi.fn(),
    });
    const back = navigationEvent('https://scribe.example/previous');
    history(back);
    expect(back.preventDefault).toHaveBeenCalledOnce();
    vi.mocked(window.confirm).mockReturnValue(true);
    const allowed = event();
    listener(allowed);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    const unrelated = navigationEvent('https://scribe.example/different');
    history(unrelated);
    expect(unrelated.preventDefault).toHaveBeenCalledOnce();
    listener(event());
    const approved = navigationEvent('https://scribe.example/app');
    history(approved);
    expect(approved.preventDefault).not.toHaveBeenCalled();
  });

  it('bounds the terminal drain if done never arrives without losing the accepted note or final meter', async () => {
    vi.useFakeTimers();
    const socket = await startCapture();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.emit({ type: 'final', note: completedNote });
    socket.emit({ type: 'meter', summary: finalMeter });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(socket.close).not.toHaveBeenCalled();
    expect(savedDrafts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(savedDrafts()).toHaveLength(1);
    expect(savedMeters()).toEqual([finalMeter]);
    expect(hasReview()).toBe(true);
    await vi.advanceTimersByTimeAsync(310_000);
    expect(harness.sockets).toHaveLength(1);
    expect(savedDrafts()).toHaveLength(1);
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/live-token')),
    ).toHaveLength(1);
  });

  it('keeps a real denial before final fail-closed and ignores a late final from that socket', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.status('unauthorized');
    socket.emit({ type: 'final', note: completedNote });
    socket.emit({ type: 'meter', summary: finalMeter });
    socket.status('done');
    expect(socket.close).toHaveBeenCalledOnce();
    expect(savedDrafts()).toEqual([]);
    expect(savedMeters()).toEqual([]);
    expect(hasReview()).toBe(false);
    expect(text(render())).toContain('could not be authorised');
    expect(text(render())).toContain('Some words may be missing.');
    expect(action('Resume recording')).toBeDefined();
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });

  it('does not unlock review or a new consult on failed final save and retries only the same draft', async () => {
    const socket = await startCapture();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Unavailable' }, { status: 503 }),
    );
    socket.emit({ type: 'final', note: completedNote });
    socket.emit({ type: 'meter', summary: finalMeter });
    socket.status('done');
    await vi.waitFor(() => expect(action('Retry saving draft')).toBeDefined());
    expect(hasReview()).toBe(false);
    expect(savedMeters()).toEqual([]);
    expect(action('New consult')?.props.disabled).toBe(true);
    expect(action('Resume recording')).toBeUndefined();
    expect(socket.close).toHaveBeenCalledOnce();
    click('Retry saving draft');
    await vi.waitFor(() => expect(hasReview()).toBe(true));
    expect(savedDrafts()).toHaveLength(2);
    expect(savedDrafts()[1]).toEqual(savedDrafts()[0]);
    expect(savedMeters()).toEqual([finalMeter]);
    expect(harness.sockets).toHaveLength(1);
  });

  it('explains a rejected example-contaminated draft without allowing signing', async () => {
    const socket = await startCapture();
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ code: 'MEDICAL_TRANSCRIPTION_EXAMPLE' }, { status: 422 }),
    );
    socket.emit({ type: 'final', note: completedNote });
    socket.status('done');
    await vi.waitFor(() =>
      expect(text(render())).toContain('suspected example text that may not have been spoken'),
    );
    expect(hasReview()).toBe(false);
    expect(savedMeters()).toEqual([]);
    expect(action('New consult')?.props.disabled).toBe(true);
  });

  it('surfaces quarantined transcription and persists its review requirement through final save', async () => {
    const socket = await startCapture();
    socket.emit({ type: 'utterance', utterance });
    socket.emit({ type: 'transcriptionWarning', startMs: 3_000, endMs: 5_000 });
    expect(text(render())).toContain('Unreliable text was withheld.');
    expect(text(render())).toContain('Some words may be missing.');
    expect(displayedUtterances()).toEqual([utterance]);
    click('End & review note');
    await vi.waitFor(() => expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true));
    socket.emit({ type: 'final', note: completedNote });
    socket.status('done');
    await vi.waitFor(() => expect(savedDrafts()).toHaveLength(1));
    expect(savedDrafts()[0]).toMatchObject({
      captureIncomplete: true,
      captureIncompleteReason: 'audio_loss',
      transcript: 'Patient: I have had a cough for two days.',
    });
    expect(text(render())).toContain('Unreliable text was withheld.');
  });

  it.each([
    ['SCRIBE_CHECKPOINT_SOURCE_CONFLICT', 409, 'another tab has saved additional or different'],
    ['SCRIBE_CHECKPOINT_UNAVAILABLE', 503, 'securely saved captured words could not be checked'],
  ] as const)(
    'keeps a rejected final unsaved and explains %s recovery',
    async (code, status, message) => {
      const socket = await startCapture();
      click('End & review note');
      await vi.waitFor(() =>
        expect(commands(socket).some(({ type }) => type === 'stop')).toBe(true),
      );
      vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code }, { status }));
      socket.emit({ type: 'final', note: completedNote });
      socket.status('done');
      await vi.waitFor(() => expect(text(render())).toContain(message));
      expect(hasReview()).toBe(false);
      expect(action('New consult')?.props.disabled).toBe(true);
      expect(savedMeters()).toEqual([]);
    },
  );
});
