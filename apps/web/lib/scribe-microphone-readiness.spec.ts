import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  check: vi.fn(),
  microphone: vi.fn(),
  request: vi.fn(),
  socket: vi.fn(),
}));

// Real rendered event handlers, deterministic hook scheduling, and mocked
// browser media only. These tests do not open any physical microphone or
// establish that a particular browser/device is clinically ready.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
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
  useCallback: <T>(callback: T) => callback,
  useMemo: <T>(factory: () => T) => factory(),
  useId: () => 'microphone-dialog-id',
}));
vi.mock('../lib/audio/microphone-check', async (original) => ({
  ...(await original<typeof import('./audio/microphone-check')>()),
  checkMicrophone: harness.check,
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));

import { ScribeMicrophoneDialog } from '../components/app/ScribeMicrophoneDialog';
import { MicrophoneCheckError } from './audio/microphone-check';

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void;
  onCancel?: (event: { preventDefault: () => void }) => void;
  onClose?: () => void;
  ref?: { current: unknown } | ((instance: unknown) => void);
  role?: string;
  disabled?: boolean;
  value?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
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
    .join(' ');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

let currentProps: Parameters<typeof ScribeMicrophoneDialog>[0];
let permission: EventTarget & { state: PermissionState };
let mediaDevices: EventTarget & {
  getUserMedia: typeof harness.microphone;
  enumerateDevices: ReturnType<typeof vi.fn>;
};
let permissionsQuery: ReturnType<typeof vi.fn>;
let page: EventTarget & { visibilityState: DocumentVisibilityState; hidden: boolean };
let browser: EventTarget;
let dialog: { open: boolean; showModal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

function render() {
  harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
  const view = ScribeMicrophoneDialog(currentProps);
  for (const element of elements(view)) {
    if (element.type !== 'dialog') continue;
    const ref = element.props.ref;
    if (typeof ref === 'function') ref(dialog);
    else if (ref) ref.current = dialog;
  }
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function button(label: RegExp) {
  return elements(render()).find(
    (element) => element.type === 'button' && label.test(text(element.props.children)),
  );
}
function click(label: RegExp) {
  const action = button(label);
  expect(action, `Missing action: ${label}`).toBeDefined();
  expect(action!.props.disabled, `Disabled action: ${label}`).not.toBe(true);
  action!.props.onClick!();
}
function selectDevice(value: string) {
  const select = elements(render()).find((element) => element.type === 'select');
  expect(select).toBeDefined();
  select!.props.onChange!({ target: { value }, currentTarget: { value } });
}
function unmount() {
  harness.effects.forEach((effect) => effect.cleanup?.());
  harness.effects = [];
  harness.queued = [];
}
async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
  render();
}

beforeEach(() => {
  vi.resetAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  currentProps = { onCancel: vi.fn(), onContinue: vi.fn() };
  permission = Object.assign(new EventTarget(), { state: 'prompt' as PermissionState });
  permissionsQuery = vi.fn(async () => permission);
  mediaDevices = Object.assign(new EventTarget(), {
    getUserMedia: harness.microphone,
    enumerateDevices: vi.fn(async () => [
      { kind: 'audioinput', deviceId: 'built-in', label: 'Built-in microphone' },
      { kind: 'audioinput', deviceId: 'headset', label: 'USB headset' },
      { kind: 'videoinput', deviceId: 'camera', label: 'Camera' },
    ]),
  });
  page = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hidden: false,
  });
  browser = new EventTarget();
  dialog = {
    open: false,
    showModal: vi.fn(() => {
      dialog.open = true;
    }),
    close: vi.fn(() => {
      dialog.open = false;
    }),
  };
  vi.stubGlobal('React', React);
  vi.stubGlobal('navigator', { mediaDevices, permissions: { query: permissionsQuery } });
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('fetch', harness.request);
  vi.stubGlobal('WebSocket', harness.socket);
  harness.check.mockResolvedValue({
    deviceId: 'built-in',
    label: 'Built-in microphone',
    heardSound: true,
  });
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Scribe microphone readiness dialog', () => {
  it('opens a labelled modal without opening the microphone, starting the consultation, or contacting a server', async () => {
    render();
    await settle();
    const modal = elements(render()).find((element) => element.type === 'dialog');
    expect(modal).toBeDefined();
    expect(modal!.props['aria-labelledby']).toBeTruthy();
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.microphone).not.toHaveBeenCalled();
    expect(harness.check).not.toHaveBeenCalled();
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.socket).not.toHaveBeenCalled();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    expect(text(render())).toMatch(/consent/i);
    expect(text(render())).toMatch(
      /not (?:saved|stored)|no (?:audio )?(?:recording|upload)|nothing.*(?:saved|uploaded)/i,
    );
  });

  it('explains that explicit Enable microphone requests browser permission and does not start a consult', async () => {
    render();
    await settle();
    expect(button(/Enable microphone.*test/i)).toBeDefined();
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    click(/Enable microphone.*test/i);
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(harness.check.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.socket).not.toHaveBeenCalled();
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    click(/Start consultation/i);
    expect(currentProps.onContinue).toHaveBeenCalledExactlyOnceWith('built-in');
  });

  it('tests an already allowed microphone without promising another browser popup', async () => {
    permission.state = 'granted';
    render();
    await settle();
    expect(button(/^Test microphone$/i)).toBeDefined();
    expect(harness.check).not.toHaveBeenCalled();
    click(/^Test microphone$/i);
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
  });

  it('shows blocked-permission recovery rather than implying that opening the dialog will show a popup', async () => {
    permission.state = 'denied';
    render();
    await settle();
    expect(text(render())).toMatch(/blocked|denied/i);
    expect(text(render())).toMatch(/site settings|address bar|browser settings/i);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.check).not.toHaveBeenCalled();
    expect(harness.microphone).not.toHaveBeenCalled();
  });

  it('keeps an explicit test available when the browser cannot report the microphone permission state', async () => {
    permissionsQuery.mockRejectedValueOnce(new TypeError('Permission name not supported'));
    render();
    await settle();
    expect(button(/(?:Enable microphone.*test|Test microphone)/i)).toBeDefined();
    expect(harness.check).not.toHaveBeenCalled();
    click(/(?:Enable microphone.*test|Test microphone)/i);
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
  });

  it.each([
    ['permission-denied', /permission|blocked|allow/i],
    ['ended', /stopped|ended|unavailable/i],
    ['missing', /microphone|connect/i],
    ['setup-timeout', /browser audio setup timed out/i],
    ['no-frames', /audio|frames|microphone/i],
    ['unsupported', /browser|supported/i],
  ] as const)(
    'keeps Start blocked after %s and offers explicit recovery',
    async (code, explanation) => {
      harness.check.mockRejectedValueOnce(
        new MicrophoneCheckError(code, `Synthetic ${code} failure`),
      );
      render();
      await settle();
      click(/Enable microphone.*test/i);
      await settle();
      expect(button(/Start consultation/i)?.props.disabled).toBe(true);
      expect(text(render())).toMatch(explanation);
      expect(button(/Retry microphone test/i)).toBeDefined();
      expect(currentProps.onContinue).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['loading-processor', /Preparing the audio check/, false],
    ['starting-context', /Starting browser audio/, false],
    ['waiting-input', /Checking microphone input/, true],
  ] as const)(
    'explains the %s phase without prematurely confirming input',
    async (stage, title, meter) => {
      const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
      harness.check.mockReturnValueOnce(pending.promise);
      render();
      await settle();
      click(/Enable microphone.*test/i);
      harness.check.mock.calls[0]![0].onProgress({
        stage,
        level: 0,
        frames: 0,
        device: { deviceId: 'built-in', label: 'Built-in microphone' },
      });
      expect(text(render())).toMatch(title);
      expect(elements(render()).some((element) => element.type === 'meter')).toBe(meter);
      expect(button(/Start consultation/i)?.props.disabled).toBe(true);
      expect(currentProps.onContinue).not.toHaveBeenCalled();
      click(/^Cancel$/i);
      pending.reject(new MicrophoneCheckError('cancelled'));
      await settle();
    },
  );

  it('requires a new explicit test after a failed attempt', async () => {
    harness.check.mockRejectedValueOnce(
      new MicrophoneCheckError('ended', 'The microphone stopped.'),
    );
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(1);
    click(/Retry microphone test/i);
    await settle();
    expect(harness.check).toHaveBeenCalledTimes(2);
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('passes the selected microphone to both the local check and explicit continuation', async () => {
    permission.state = 'granted';
    render();
    await settle();
    expect(text(render())).not.toMatch(/Camera/);
    selectDevice('headset');
    harness.check.mockResolvedValueOnce({
      deviceId: 'headset',
      label: 'USB headset',
      heardSound: true,
    });
    click(/^Test microphone$/i);
    expect(harness.check.mock.calls[0]![0].deviceId).toBe('headset');
    await settle();
    click(/Start consultation/i);
    expect(currentProps.onContinue).toHaveBeenCalledExactlyOnceWith('headset');
  });

  it('does not mistake a quiet but functioning microphone for a failed device', async () => {
    harness.check.mockResolvedValueOnce({
      deviceId: 'built-in',
      label: 'Built-in microphone',
      heardSound: false,
    });
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    expect(text(render())).toMatch(/quiet|silence|no sound/i);
  });

  it('uses a separate explicit Resume control without resuming automatically', async () => {
    currentProps.action = 'resume';
    render();
    await settle();
    expect(button(/Resume recording/i)?.props.disabled).toBe(true);
    click(/Enable microphone.*test/i);
    await settle();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    click(/Resume recording/i);
    expect(currentProps.onContinue).toHaveBeenCalledExactlyOnceWith('built-in');
  });

  it('aborts on Cancel and ignores a microphone success arriving after cancellation', async () => {
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    click(/Enable microphone.*test/i);
    const signal = harness.check.mock.calls[0]![0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    click(/^Cancel$/i);
    expect(signal.aborted).toBe(true);
    expect(currentProps.onCancel).toHaveBeenCalledTimes(1);
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('serializes repeated test clicks behind the same in-flight request', async () => {
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    const staleTest = button(/Enable microphone.*test/i)!.props.onClick!;
    staleTest();
    staleTest();
    expect(harness.check).toHaveBeenCalledTimes(1);
    click(/Stop microphone test/i);
    expect(harness.check.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(currentProps.onCancel).not.toHaveBeenCalled();
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
  });

  it('does not reuse a stale successful Start handler after the doctor cancels', async () => {
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    const staleContinue = button(/Start consultation/i)!.props.onClick!;
    click(/^Cancel$/i);
    staleContinue();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('continues only once even if the successful Start handler is clicked repeatedly', async () => {
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    const staleContinue = button(/Start consultation/i)!.props.onClick!;
    staleContinue();
    staleContinue();
    expect(currentProps.onContinue).toHaveBeenCalledExactlyOnceWith('built-in');
  });

  it('aborts on Escape and ignores a late result', async () => {
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    click(/Enable microphone.*test/i);
    const modal = elements(render()).find((element) => element.type === 'dialog')!;
    const preventDefault = vi.fn();
    modal.props.onCancel!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.check.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(currentProps.onCancel).toHaveBeenCalledTimes(1);
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('aborts an in-flight check when unmounted and does not act on the late result', async () => {
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    click(/Enable microphone.*test/i);
    unmount();
    expect(harness.check.mock.calls[0]![0].signal.aborted).toBe(true);
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    expect(currentProps.onCancel).not.toHaveBeenCalled();
  });

  it('invalidates success when another device is selected', async () => {
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    selectDevice('headset');
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('invalidates readiness when device availability changes', async () => {
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    mediaDevices.dispatchEvent(new Event('devicechange'));
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('preserves an actionable failure when a later device-list change refreshes devices', async () => {
    harness.check.mockRejectedValueOnce(new MicrophoneCheckError('ended'));
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    expect(text(render())).toMatch(/The microphone stopped during the check/);
    mediaDevices.dispatchEvent(new Event('devicechange'));
    await settle();
    expect(text(render())).toMatch(/The microphone stopped during the check/);
    expect(button(/Retry microphone test/i)).toBeDefined();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.check).toHaveBeenCalledTimes(1);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
    // An explicit new choice still clears the obsolete failure and needs a test.
    selectDevice('headset');
    expect(text(render())).not.toMatch(/The microphone stopped during the check/);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
  });

  it('invalidates readiness when permission is revoked', async () => {
    permission.state = 'granted';
    render();
    await settle();
    click(/^Test microphone$/i);
    await settle();
    permission.state = 'denied';
    permission.dispatchEvent(new Event('change'));
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(text(render())).toMatch(/blocked|denied/i);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('does not cancel the expected permission grant or device-label reveal during an active test', async () => {
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    click(/Enable microphone.*test/i);
    const signal = harness.check.mock.calls[0]![0].signal as AbortSignal;
    permission.state = 'granted';
    permission.dispatchEvent(new Event('change'));
    mediaDevices.dispatchEvent(new Event('devicechange'));
    await settle();
    expect(signal.aborted).toBe(false);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.check).toHaveBeenCalledTimes(1);
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('aborts a check if permission is revoked while the browser probe is active', async () => {
    permission.state = 'granted';
    const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
    harness.check.mockReturnValueOnce(pending.promise);
    render();
    await settle();
    click(/^Test microphone$/i);
    permission.state = 'denied';
    permission.dispatchEvent(new Event('change'));
    expect(harness.check.mock.calls[0]![0].signal.aborted).toBe(true);
    pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(text(render())).toMatch(/blocked/i);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('does not start a test automatically when blocked permission becomes allowed', async () => {
    permission.state = 'denied';
    render();
    await settle();
    permission.state = 'granted';
    permission.dispatchEvent(new Event('change'));
    await settle();
    expect(button(/^Test microphone$/i)).toBeDefined();
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(harness.check).not.toHaveBeenCalled();
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });

  it('ignores permission-query results from an earlier Strict Mode effect lifetime', async () => {
    const firstPermission = Object.assign(new EventTarget(), {
      state: 'denied' as PermissionState,
    });
    const firstQuery = deferred<typeof firstPermission>();
    const listen = vi.spyOn(firstPermission, 'addEventListener');
    permissionsQuery.mockReturnValueOnce(firstQuery.promise);
    render();
    unmount();
    permission.state = 'granted';
    render();
    await settle();
    expect(button(/^Test microphone$/i)).toBeDefined();
    firstQuery.resolve(firstPermission);
    await settle();
    expect(listen).not.toHaveBeenCalled();
    expect(button(/^Test microphone$/i)).toBeDefined();
    expect(text(render())).not.toMatch(/Microphone access is blocked/);
    expect(harness.check).not.toHaveBeenCalled();
  });

  it.each(['visibilitychange', 'pagehide'])(
    'aborts local capture on %s and ignores late progress/results',
    async (event) => {
      const pending = deferred<{ deviceId: string; label: string; heardSound: boolean }>();
      harness.check.mockReturnValueOnce(pending.promise);
      render();
      await settle();
      click(/Enable microphone.*test/i);
      if (event === 'visibilitychange') {
        page.visibilityState = 'hidden';
        page.hidden = true;
        page.dispatchEvent(new Event(event));
      } else browser.dispatchEvent(new Event(event));
      const options = harness.check.mock.calls[0]![0];
      expect(options.signal.aborted).toBe(true);
      options.onProgress({
        stage: 'checking',
        level: 0.2,
        frames: 1,
        device: { deviceId: 'built-in', label: 'Built-in microphone' },
      });
      pending.resolve({ deviceId: 'built-in', label: 'Built-in microphone', heardSound: true });
      await settle();
      expect(elements(render()).some((element) => element.type === 'meter')).toBe(false);
      expect(button(/Start consultation/i)?.props.disabled).toBe(true);
      expect(currentProps.onContinue).not.toHaveBeenCalled();
    },
  );

  it('expires a successful test rather than keeping stale microphone readiness forever', async () => {
    vi.useFakeTimers();
    render();
    await settle();
    click(/Enable microphone.*test/i);
    await settle();
    expect(button(/Start consultation/i)?.props.disabled).not.toBe(true);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(button(/Start consultation/i)?.props.disabled).toBe(true);
    expect(currentProps.onContinue).not.toHaveBeenCalled();
  });
});

describe('Scribe microphone dialog integration source guards', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../components/app/DoctorLiveEncounter.tsx'),
    'utf8',
  );

  it('routes normal Start and Resume through the readiness dialog', () => {
    expect(source).toContain("onClick={() => prepareCapture('start')}");
    expect(source).toContain("onClick={() => prepareCapture('resume')}");
    expect(source).toContain('selectedDeviceId: selectedMicrophoneId');
    expect(source).toContain('waitForMicrophoneFrames: true');
    expect(source).toContain('onContinue={microphoneReady}');
  });

  it('keeps teleconsult-owned capture outside the standalone microphone test', () => {
    const prepare = source.slice(
      source.indexOf('function prepareCapture('),
      source.indexOf('function microphoneReady('),
    );
    expect(prepare).toMatch(
      /if \(teleconsultRef\.current\) \{[\s\S]*resumeAuthorizedCapture\(\)[\s\S]*start\(\)[\s\S]*return;[\s\S]*\}[\s\S]*setMicrophoneDialog\(action\)/,
    );
    expect(source).toContain('{microphoneDialog && !teleconsult && (');
    expect(source).toContain("captureSource: teleconsult ? 'external' : 'microphone'");
  });

  it('lets legacy autoStart open preparation only, never the microphone or gateway', () => {
    const autoStart = source.slice(
      source.indexOf('const autoStartedRef = useRef(false)'),
      source.indexOf('function prepareCapture('),
    );
    expect(autoStart).toContain("if (!teleconsultRef.current) setMicrophoneDialog('start')");
    expect(autoStart).not.toMatch(/\b(?:start|connect|resumeAuthorizedCapture)\(/);
  });

  it('keeps the local diagnostics page unavailable outside explicitly enabled development', () => {
    const preview = readFileSync(
      resolve(import.meta.dirname, '../app/dev/scribe-microphone/page.tsx'),
      'utf8',
    );
    expect(preview).toContain("process.env['NODE_ENV'] !== 'development'");
    expect(preview).toContain("process.env['SCRIBE_WORKSPACE_PREVIEW'] !== 'true'");
    expect(preview).toContain('notFound()');
    const client = readFileSync(
      resolve(import.meta.dirname, '../app/dev/scribe-microphone/ScribeMicrophonePreview.tsx'),
      'utf8',
    );
    expect(client).not.toMatch(/\bfetch\s*\(|new\s+WebSocket\s*\(/);
    expect(client).toContain('environment={realDevice ? undefined : environment}');
  });
});
