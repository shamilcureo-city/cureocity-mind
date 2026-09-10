import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as Array<{ current: unknown }>,
  refIndex: 0,
  effects: [] as Array<() => (() => void) | void>,
  registerEffects: true,
  push: vi.fn(),
  cueReview: vi.fn(),
  sockets: [] as Socket[],
  onFrame: (_pcm: Uint8Array) => {},
  stream: { state: 'idle', error: null, start: vi.fn(async () => {}), stop: vi.fn(async () => {}) },
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useMemo: <T>(compute: () => T) => compute(),
  useEffect: (effect: () => (() => void) | void) => {
    if (harness.registerEffects) harness.effects.push(effect);
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
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/lib/audio/use-live-stream', () => ({
  useLiveStream: (opts: { onFrame: (pcm: Uint8Array) => void }) => {
    harness.onFrame = opts.onFrame;
    return harness.stream;
  },
}));
vi.mock('@/lib/audio/use-wake-lock', () => ({ useWakeLock: () => {} }));
// Cue persistence and timestamp-clock hooks have dedicated behavior tests.
vi.mock('@/lib/use-mind-cue-review', () => ({
  useMindCueReview: () => ({
    records: [],
    labels: {},
    loaded: true,
    error: null,
    pendingId: null,
    resolvedIds: new Set(),
    review: harness.cueReview,
    retry: vi.fn(),
    reload: vi.fn(),
    blocked: false,
  }),
}));
vi.mock('@/lib/use-capture-view-clock', () => ({ useCaptureViewClock: () => 0 }));
vi.mock('@/lib/use-modal-a11y', () => ({ useModalA11y: () => {} }));
vi.mock('../components/app/GatewayMockBanner', () => ({ GatewayMockBanner: () => null }));
vi.mock('../components/app/TherapyCopilotRail', () => ({ TherapyCopilotRail: () => null }));
vi.mock('../components/app/MindTherapyGuide', () => ({ MindTherapyGuide: () => null }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
import { TherapistLiveSession } from '../components/app/TherapistLiveSession';
import { CaptureStatusBar } from '../components/app/CaptureStatusBar';
import { TherapyCopilotRail } from '../components/app/TherapyCopilotRail';
import { MindConsentRecovery } from '../components/app/MindConsentRecovery';
import { LIVE_CAPTURE_STOP_TIMEOUT_MS } from './audio/live-stream-cleanup';

class Socket {
  static OPEN = 1;
  OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  // Delay the close event deliberately, as the network is allowed to do.
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
  status(state: string) {
    this.onmessage?.({ data: JSON.stringify({ type: 'status', state }) });
  }
}
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
let sessionStatus: 'SCHEDULED' | 'IN_PROGRESS' = 'IN_PROGRESS';
let autoStart = false;
let priorRisk = false;
function render() {
  harness.stateIndex = 0;
  harness.refIndex = 0;
  const view = TherapistLiveSession({
    sessionId: 's-1',
    sessionStatus,
    clientId: 'c-1',
    kind: 'TREATMENT',
    modality: null,
    language: 'en',
    autoStart,
    priorRisk,
  });
  harness.registerEffects = false;
  return view;
}
function mount() {
  render();
  const cleanups = harness.effects
    .map((effect) => effect())
    .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
  return () => cleanups.forEach((cleanup) => cleanup());
}
function click(label: string) {
  const button = elements(render()).find(
    (el) => el.type === 'button' && text(el.props.children) === label,
  );
  expect(button, `Missing action: ${label}`).toBeDefined();
  expect(button!.props.disabled).not.toBe(true);
  button!.props.onClick!();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.sockets = [];
  harness.registerEffects = true;
  sessionStatus = 'IN_PROGRESS';
  autoStart = false;
  priorRisk = false;
  harness.stream.start.mockResolvedValue(undefined);
  harness.stream.stop.mockResolvedValue(undefined);
  vi.stubGlobal('React', React);
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('window', {
    location: { protocol: 'http:' },
    localStorage: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => new Response('{"token":"fixture-token","expiresInSec":300}', { status: 200 }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('same-session consent recovery wiring', () => {
  it('keeps capture stopped and resumes only through a fresh authorization after confirmation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"code":"SESSION_CONSENT_INVALID","error":"CROSS_BORDER_PROCESSING"}', {
        status: 409,
      }),
    );
    mount();
    click('Start session');
    await vi.waitFor(() =>
      expect(elements(render()).some((element) => element.type === MindConsentRecovery)).toBe(true),
    );
    expect(harness.stream.start).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);
    const panel = elements(render()).find((element) => element.type === MindConsentRecovery)!;
    const props = panel.props as unknown as { sessionId: string; onConfirmed(): void };
    expect(props.sessionId).toBe('s-1');
    props.onConfirmed();
    expect(harness.stream.start).not.toHaveBeenCalled();
    expect(harness.push).not.toHaveBeenCalled();
    expect(text(render())).toContain('Recording is still off');
    click('Resume recording');
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2));
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => url === '/api/v1/sessions/s-1/live-token'),
    ).toBe(true);
    expect(harness.stream.start).not.toHaveBeenCalled();
  });
  it('does not show the consent form for terminal or concurrency conflicts', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('{"code":"SESSION_INVALID_STATE"}', { status: 409 }),
    );
    mount();
    click('Start session');
    await vi.waitFor(() => expect(text(render())).toContain('no longer open for recording'));
    expect(elements(render()).some((element) => element.type === MindConsentRecovery)).toBe(false);
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  it('keeps the selected draft and transcript visible across consent recovery without implying or restarting capture', async () => {
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    socket.status('listening');
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'utterance',
        utterance: {
          id: 'retained-utterance',
          speaker: 'patient',
          text: 'Fictional words already transcribed.',
          tStartMs: 0,
          tEndMs: 1000,
        },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'therapyNote',
        kind: 'TREATMENT',
        note: { subjective: 'Fictional draft already received.' },
      }),
    });
    click('Show draft');
    click('Show transcript');

    // Read rendered conditional content and exclude explicitly hidden ancestors;
    // this is hook/event wiring, not a claim of browser layout verification.
    function visibleText(node: ReactNode): string {
      return Children.toArray(node)
        .map((child) => {
          if (!isValidElement<ElementProps & { hidden?: boolean; className?: string }>(child))
            return String(child);
          if (child.props.hidden || child.props.className?.split(/\s+/).includes('hidden'))
            return '';
          return visibleText(child.props.children);
        })
        .join('');
    }
    const expectRetainedContent = (view: ReactNode) => {
      const visible = visibleText(view);
      expect(visible).toContain('Fictional words already transcribed.');
      expect(visible).toContain('Fictional draft already received.');
      expect(visible).not.toMatch(/Listening…|Writing…/);
      expect(visible).toContain('Hide draft');
      expect(visible).toContain('Hide transcript');
    };

    socket.status('unauthorized');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('{"code":"SESSION_CONSENT_INVALID"}', { status: 409 }),
    );
    click('Try again');
    await vi.waitFor(() =>
      expect(elements(render()).some((element) => element.type === MindConsentRecovery)).toBe(true),
    );
    const blocked = render();
    expectRetainedContent(blocked);
    expect(visibleText(blocked)).toContain('Capture off · consent required');
    const panel = elements(blocked).find((element) => element.type === MindConsentRecovery)!;
    const props = panel.props as unknown as { sessionId: string; onConfirmed(): void };
    expect(props.sessionId).toBe('s-1');
    props.onConfirmed();

    const confirmed = render();
    expectRetainedContent(confirmed);
    expect(visibleText(confirmed)).toContain('Previous draft retained · capture off');
    expect(visibleText(confirmed)).toContain('Recording is still off');
    const resume = elements(confirmed).find(
      (element) => element.type === 'button' && text(element.props.children) === 'Resume recording',
    );
    expect(resume).toBeDefined();
    expect((resume!.props as unknown as { ref?: unknown }).ref).toBeDefined();
    expect(harness.stream.start).toHaveBeenCalledOnce();
    expect(harness.sockets).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(harness.push).not.toHaveBeenCalled();
    unmount();
  });
});

describe('real TherapistLiveSession attempt lifecycle wiring', () => {
  it('a failed visibility receipt keeps the safety cue open and retries the actual review action, without audio', async () => {
    priorRisk = true;
    mount();
    type CueProps = {
      onResolve: (id: string, kind: 'RED_FLAG', event: 'acted', label: string) => Promise<void>;
      onRetry: () => void;
      reviewError: string | null;
      reasoning: { riskWatch: { id: string }[] };
    };
    const rail = () =>
      elements(render()).find((element) => element.type === TherapyCopilotRail)!
        .props as unknown as CueProps;
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await rail().onResolve('risk-recheck', 'RED_FLAG', 'acted', 'Fictional cue');
    expect(rail().reviewError).toContain('visibility could not be confirmed');
    expect(rail().reasoning.riskWatch).toHaveLength(1);
    expect(harness.cueReview).not.toHaveBeenCalled();
    rail().onRetry();
    await vi.waitFor(() =>
      expect(harness.cueReview).toHaveBeenCalledWith('risk-recheck', 'RED_FLAG', 'reviewed'),
    );
    expect(rail().reviewError).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.map(([, options]) => JSON.parse(String(options?.body))),
    ).toEqual([
      { event: 'shown', suggestionId: 'risk-recheck', kind: 'RED_FLAG' },
      { event: 'shown', suggestionId: 'risk-recheck', kind: 'RED_FLAG' },
    ]);
    expect(harness.stream.start).not.toHaveBeenCalled();
    expect(harness.sockets).toHaveLength(0);
  });
  it.each([
    { token: 'fixture-token' },
    { token: '', expiresInSec: 300 },
    { token: 'fixture-token', expiresInSec: 0 },
    { token: 'fixture-token', expiresInSec: '300' },
  ])(
    'requires a valid initial authorization lease before socket or mic ($expiresInSec)',
    async (lease) => {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(lease), { status: 200 }));
      mount();
      click('Start session');
      await vi.waitFor(() =>
        expect(text(render())).toContain('Could not verify live authorization'),
      );
      expect(harness.sockets).toHaveLength(0);
      expect(harness.stream.start).not.toHaveBeenCalled();
    },
  );

  it('measures the initial lease from before the token request, not its delayed response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T00:00:00Z'));
    vi.mocked(fetch).mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-09-08T00:00:06Z'));
      return new Response('{"token":"already-expired","expiresInSec":5}', { status: 200 });
    });
    mount();
    click('Start session');
    await vi.waitFor(() => expect(text(render())).toContain('Could not verify live authorization'));
    expect(harness.sockets).toHaveLength(0);
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  async function listening() {
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    socket.status('listening');
    render();
    return socket;
  }
  async function pause(socket: Socket) {
    click('Pause recording');
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(2));
    return JSON.parse(socket.send.mock.calls[1][0] as string) as {
      type: string;
      requestId: string;
    };
  }

  it('clears displayed context-derived reasoning on revocation without removing deterministic safety or transcript', async () => {
    priorRisk = true;
    const socket = await listening();
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'utterance',
        utterance: {
          id: 'u-1',
          text: 'Fictional spoken words',
          speaker: 'patient',
          tStartMs: 0,
          tEndMs: 1000,
        },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'therapyReasoning',
        reasoning: {
          version: 1,
          riskWatch: [
            {
              id: 'risk-recheck',
              label: 'Re-check ideation',
              why: 'Prior risk',
              severity: 'high',
              source: 'CARRIED_RISK',
              sourceUtteranceIds: [],
            },
            {
              id: 'derived-risk',
              label: 'Fictional contextual risk',
              why: 'Reviewed background',
              severity: 'medium',
              source: 'LIVE',
              sourceUtteranceIds: ['u-1'],
            },
          ],
          askNext: [
            {
              id: 'carried-0',
              question: 'Clinician planned question',
              why: 'Planned',
              source: 'CARRIED',
              priority: 'normal',
              status: 'open',
              sourceUtteranceIds: [],
            },
            {
              id: 'derived-ask',
              question: 'Derived from old measure',
              why: 'Background',
              source: 'LIVE',
              priority: 'normal',
              status: 'open',
              sourceUtteranceIds: ['u-1'],
            },
          ],
          threads: [
            {
              id: 'derived-thread',
              topic: 'Old measure detail',
              note: 'Background',
              mentions: 1,
              sourceUtteranceIds: ['u-1'],
            },
          ],
          arc: { phase: 'opening', elapsedMin: 1, plannedMin: 50, suggestion: 'Opening' },
        },
      }),
    });
    const rail = () =>
      elements(render()).find((element) => element.type === TherapyCopilotRail)!
        .props as unknown as {
        reasoning: {
          riskWatch: { id: string }[];
          askNext: { id: string }[];
          threads: unknown[];
          arc: { phase: string };
        };
      };
    expect(rail().reasoning.threads).toHaveLength(1);
    const stopsBeforeRevocation = harness.stream.stop.mock.calls.length;
    socket.onmessage?.({
      data: JSON.stringify({ type: 'therapyContextCleared', reason: 'CAPABILITY_CHANGED' }),
    });
    expect(rail().reasoning.riskWatch.map((item) => item.id)).toEqual(['risk-recheck']);
    expect(rail().reasoning.askNext.map((item) => item.id)).toEqual(['carried-0']);
    expect(rail().reasoning.threads).toEqual([]);
    expect(rail().reasoning.arc.phase).toBe('opening');
    click('Show transcript');
    expect(text(render())).toContain('Fictional spoken words');
    expect(harness.stream.stop).toHaveBeenCalledTimes(stopsBeforeRevocation);
  });

  it('Start stays in shared capture controls before the guide/rails and sends buffered audio only after listening', async () => {
    mount();
    const rendered = elements(render());
    const controlsIndex = rendered.findIndex((el) => el.type === CaptureStatusBar);
    expect(controlsIndex).toBeGreaterThan(-1);
    expect(text(rendered[controlsIndex])).toContain('Start session');
    expect(controlsIndex).toBeLessThan(
      rendered.findIndex((el) => text(el.props.children).startsWith('Quiet focus')),
    );
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    const audio = new Uint8Array([1, 2]);
    harness.onFrame(audio);
    expect(socket.send).toHaveBeenCalledOnce();
    socket.status('listening');
    expect(socket.send).toHaveBeenNthCalledWith(2, audio);
  });

  it('pause waits for matching acknowledgement, sends no stop, blocks new audio, and explicitly reauthorizes resume', async () => {
    const socket = await listening();
    const command = await pause(socket);
    expect(command.type).toBe('pause');
    expect(text(render())).toContain('Microphone off');
    expect(text(render())).not.toContain('Resume recording');
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: crypto.randomUUID() }),
    });
    expect(text(render())).not.toContain('Resume recording');
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: command.requestId }),
    });
    await vi.waitFor(() => expect(text(render())).toContain('Resume recording'));
    harness.onFrame(new Uint8Array([3, 4]));
    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
    expect(harness.push).not.toHaveBeenCalled();
    click('Resume recording');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(socket.close).toHaveBeenCalledOnce();
    expect(harness.stream.start).toHaveBeenCalledOnce();
    const replacement = harness.sockets[1];
    replacement.open();
    await vi.waitFor(() => expect(harness.stream.start).toHaveBeenCalledTimes(2));
  });

  it('unsupported old gateway never produces a confirmed pause; End remains explicit', async () => {
    const socket = await listening();
    vi.useFakeTimers();
    click('Pause recording');
    await vi.advanceTimersByTimeAsync(30_001);
    expect(text(render())).toContain('pause not confirmed');
    expect(text(render())).toContain('pause-support update');
    expect(text(render())).not.toContain('Resume recording');
    expect(harness.push).not.toHaveBeenCalled();
    click('End session');
    click('End & save');
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'stop' }));
  });

  it('paused authorization expiry keeps the microphone off until explicit resume', async () => {
    const socket = await listening();
    const command = await pause(socket);
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: command.requestId }),
    });
    await vi.waitFor(() => expect(text(render())).toContain('Resume recording'));
    socket.status('unauthorized');
    socket.onclose?.();
    expect(text(render())).toContain('Resume recording');
    expect(text(render())).toContain('Microphone off');
    expect(harness.stream.start).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('a failed local final-frame flush cannot be retried into a falsely safe pause or resumed microphone', async () => {
    await listening();
    harness.stream.stop.mockRejectedValueOnce(new Error('worklet timeout'));
    click('Pause recording');
    await vi.waitFor(() => expect(text(render())).toContain('final audio frame was not confirmed'));
    expect(text(render())).not.toContain('Resume recording');
    expect(text(render())).not.toContain('Retry pause confirmation');
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });

  it('a hung local stop becomes recoverable instead of waiting indefinitely or confirming pause', async () => {
    const socket = await listening();
    vi.useFakeTimers();
    let finishStop!: () => void;
    harness.stream.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = resolve;
        }),
    );
    click('Pause recording');
    expect(text(render())).toContain('confirming the last audio');
    await vi.advanceTimersByTimeAsync(LIVE_CAPTURE_STOP_TIMEOUT_MS);
    expect(text(render())).toContain('final audio frame was not confirmed');
    expect(text(render())).not.toContain('Resume recording');
    expect(text(render())).not.toContain('Retry pause confirmation');
    expect(socket.close).toHaveBeenCalledOnce();
    finishStop();
    socket.status('listening');
    harness.onFrame(new Uint8Array([1, 2]));
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send).toHaveBeenCalledOnce(); // only the original start, no pause/stop/audio
    expect(harness.stream.start).toHaveBeenCalledOnce();
    expect(harness.push).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'a late old pause stop %s cannot mute or mark a replacement capture unsafe',
    async (mode) => {
      const first = await listening();
      let resolveStop!: () => void;
      let rejectStop!: (reason: Error) => void;
      harness.stream.stop.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            resolveStop = resolve;
            rejectStop = reject;
          }),
      );
      click('Pause recording');
      first.status('busy');
      click('Try again');
      await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
      const replacement = harness.sockets[1];
      replacement.open();
      await vi.waitFor(() => expect(replacement.send).toHaveBeenCalledOnce());
      replacement.status('listening');
      if (mode === 'resolve') resolveStop();
      else rejectStop(new Error('old stop failed'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const audio = new Uint8Array([1, 2]);
      harness.onFrame(audio);
      expect(replacement.send).toHaveBeenLastCalledWith(audio);
      expect(text(render())).not.toContain('final audio frame was not confirmed');
      expect(replacement.close).not.toHaveBeenCalled();
      expect(harness.push).not.toHaveBeenCalled();
    },
  );

  it('End cannot silently finalize or resume after a stop timeout, even when stop resolves late', async () => {
    const socket = await listening();
    vi.useFakeTimers();
    let finishStop!: () => void;
    harness.stream.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = resolve;
        }),
    );
    click('End session');
    click('End & save');
    await vi.advanceTimersByTimeAsync(LIVE_CAPTURE_STOP_TIMEOUT_MS);
    expect(text(render())).toContain('final audio frame was not confirmed');
    expect(text(render())).not.toContain('Resume recording');
    expect(socket.close).toHaveBeenCalledOnce();
    finishStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce(); // no finalization/save request
    expect(harness.push).not.toHaveBeenCalled();
  });

  it('unmount during stop prevents late pause/finalization commands or state writes', async () => {
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    socket.status('listening');
    let finishStop!: () => void;
    harness.stream.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = resolve;
        }),
    );
    click('Pause recording');
    unmount();
    const statesAfterUnmount = [...harness.states];
    finishStop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.states).toEqual(statesAfterUnmount);
    expect(socket.send).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });

  it('late pause acknowledgement cannot confirm a timed-out request or its retry', async () => {
    const socket = await listening();
    vi.useFakeTimers();
    const first = await pause(socket);
    await vi.advanceTimersByTimeAsync(30_000);
    click('Retry pause confirmation');
    await vi.advanceTimersByTimeAsync(0);
    const retry = JSON.parse(socket.send.mock.calls[2][0] as string) as { requestId: string };
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: first.requestId }),
    });
    expect(text(render())).not.toContain('Resume recording');
    socket.onmessage?.({
      data: JSON.stringify({ type: 'capturePaused', requestId: retry.requestId }),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(text(render())).toContain('Resume recording');
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });
  it('effect cleanup/replay cancels the first auto-start and permits only its replacement', async () => {
    autoStart = true;
    let finishFirst!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = resolve;
        }),
    );
    const cleanup = mount();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    cleanup();
    // React StrictMode replays setup after cleanup with the same hook refs.
    harness.effects.forEach((effect) => effect());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    finishFirst(new Response('{"token":"stale"}', { status: 200 }));
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledOnce());
    expect(harness.stream.start).toHaveBeenCalledOnce();
  });
  it('late old close/error/status cannot stop or mutate a newer live capture', async () => {
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const first = harness.sockets[0];
    first.open();
    await vi.waitFor(() => expect(first.send).toHaveBeenCalledOnce());
    first.status('listening');
    render();
    first.status('busy');
    click('Try again');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    const second = harness.sockets[1];
    second.open();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledOnce());
    second.status('listening');
    render();
    const stops = harness.stream.stop.mock.calls.length;
    first.onerror?.();
    first.onclose?.();
    first.status('done');
    expect(harness.stream.stop).toHaveBeenCalledTimes(stops);
    expect(text(render())).toContain('End session');
    expect(text(render())).not.toContain('The live connection dropped');
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('unmount while the token is pending aborts it and never creates a socket or microphone', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    unmount();
    expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    finish(new Response('{"token":"late-token"}', { status: 200 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.sockets).toHaveLength(0);
    expect(harness.stream.start).not.toHaveBeenCalled();
  });

  it('unmount during microphone startup cannot subsequently authorize or send gateway start', async () => {
    sessionStatus = 'SCHEDULED';
    let activate!: () => void;
    harness.stream.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          activate = resolve;
        }),
    );
    const unmount = mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const socket = harness.sockets[0];
    socket.open();
    await vi.waitFor(() => expect(activate).toBeDefined());
    unmount();
    activate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
    expect(socket.send).not.toHaveBeenCalled();
  });

  it('a stale startup rejection cannot stop the replacement microphone', async () => {
    let rejectStart!: (error: Error) => void;
    harness.stream.start.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    mount();
    click('Start session');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
    const first = harness.sockets[0];
    first.open();
    render();
    await vi.waitFor(() => expect(rejectStart).toBeDefined());
    first.onerror?.();
    click('Try again');
    await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
    const second = harness.sockets[1];
    second.open();
    await vi.waitFor(() => expect(second.send).toHaveBeenCalledOnce());
    const stops = harness.stream.stop.mock.calls.length;
    rejectStart(new Error('old microphone failed'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.stream.stop).toHaveBeenCalledTimes(stops);
    expect(second.close).not.toHaveBeenCalled();
  });
});
