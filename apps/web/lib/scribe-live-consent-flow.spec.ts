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
  push: vi.fn(),
  request: vi.fn(),
  microphone: vi.fn(),
  socket: vi.fn(),
}));

// Exercise real rendered handlers and async handoff ordering. This is a
// deterministic hook harness, not a browser-media or DOM-accessibility test.
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
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: harness.push }) }));
vi.mock('../components/app/ContextFlash', () => ({ ContextFlash: 'context-flash' }));
vi.mock('../components/app/DoctorLiveEncounter', () => ({
  DoctorLiveEncounter: 'doctor-live-encounter',
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));

import { LiveEncounterFlow } from '../components/app/LiveEncounterFlow';

const SESSION_ID = 'scheduled-session';
const SCOPES = ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'];
const SAVE_LABEL = 'Save consent and open live consult';
const DECLINE_LABEL = 'Patient declined — use dictation';
const props = () => ({
  sessionId: SESSION_ID,
  sessionStatus: 'SCHEDULED',
  clientId: 'fictional-client',
  specialty: 'family medicine',
  patient: { name: 'Fictional patient', age: 30 },
  showFlash: false,
});
let currentProps = props();

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { checked: boolean }; currentTarget: { checked: boolean } }) => void;
  onDone?: () => void;
  type?: string;
  role?: string;
  checked?: boolean;
  disabled?: boolean;
  autoStart?: boolean;
  sessionId?: string;
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
  harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
  const view = LiveEncounterFlow(currentProps);
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function button(label: string) {
  return elements(render()).find(
    (element) => element.type === 'button' && text(element.props.children) === label,
  );
}
function click(label: string) {
  const action = button(label);
  expect(action, `Missing action: ${label}`).toBeDefined();
  expect(action!.props.disabled, `Disabled action: ${label}`).not.toBe(true);
  action!.props.onClick!();
}
function checkboxes() {
  return elements(render()).filter(
    (element) => element.type === 'input' && element.props.type === 'checkbox',
  );
}
function setChecked(index: number, checked = true) {
  checkboxes()[index]!.props.onChange!({ target: { checked }, currentTarget: { checked } });
}
function checkAll() {
  for (let index = 0; index < 3; index++) setChecked(index);
}
function live() {
  return elements(render()).find((element) => element.type === 'doctor-live-encounter');
}
function alerts() {
  return elements(render()).filter((element) => element.props.role === 'alert');
}
function receipt() {
  return {
    id: SESSION_ID,
    status: 'SCHEDULED',
    consentSnapshot: {
      entries: SCOPES.map((scope) => ({
        scope,
        scriptVersion: 'v1.0',
        ackedAt: '2026-09-27T18:00:00.000Z',
      })),
      notes: null,
    },
  };
}
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function unmount() {
  harness.effects.forEach((effect) => effect.cleanup?.());
  harness.effects = [];
  harness.queued = [];
}

beforeEach(() => {
  vi.resetAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  currentProps = props();
  harness.request.mockImplementation(async () => response(receipt()));
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: harness.microphone } });
  vi.stubGlobal('WebSocket', harness.socket);
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('Scribe scheduled live-consent handoff', () => {
  it('starts with all three scopes unchecked and blocks incomplete confirmation', () => {
    expect(checkboxes()).toHaveLength(3);
    expect(checkboxes().every((checkbox) => checkbox.props.checked === false)).toBe(true);
    expect(button(SAVE_LABEL)?.props.disabled).toBe(true);
    expect(text(render())).toMatch(/outside India|cross-border/i);
    setChecked(0);
    setChecked(1);
    const incompleteAction = button(SAVE_LABEL)!;
    expect(incompleteAction.props.disabled).toBe(true);
    // The handler must remain safe even if invoked from a stale DOM event.
    incompleteAction.props.onClick!();
    expect(harness.request).not.toHaveBeenCalled();
    expect(live()).toBeUndefined();
    setChecked(2);
    expect(button(SAVE_LABEL)?.props.disabled).toBe(false);
    setChecked(1, false);
    expect(button(SAVE_LABEL)?.props.disabled).toBe(true);
  });

  it('waits for the persisted same-session receipt before exposing live controls', async () => {
    const pending = deferred<Response>();
    harness.request.mockReturnValueOnce(pending.promise);
    checkAll();
    click(SAVE_LABEL);
    expect(harness.request).toHaveBeenCalledTimes(1);
    const [url, init] = harness.request.mock.calls[0]!;
    expect(url).toBe(`/api/v1/sessions/${SESSION_ID}/consent`);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      scopes: SCOPES,
      scriptVersion: 'v1.0',
      captureMode: 'LIVE',
    });
    expect(live()).toBeUndefined();
    const pendingButtons = elements(render()).filter((element) => element.type === 'button');
    expect(pendingButtons).toHaveLength(2);
    expect(pendingButtons.every((element) => element.props.disabled)).toBe(true);
    expect(harness.microphone).not.toHaveBeenCalled();
    expect(harness.socket).not.toHaveBeenCalled();
    pending.resolve(response(receipt()));
    await vi.waitFor(() => expect(live()).toBeDefined());
    expect(live()?.props).toMatchObject({ sessionId: SESSION_ID, autoStart: false });
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(harness.push).not.toHaveBeenCalled();
    expect(harness.microphone).not.toHaveBeenCalled();
    expect(harness.socket).not.toHaveBeenCalled();
  });

  it('serializes repeated save and stale decline handlers behind the same in-flight guard', async () => {
    const pending = deferred<Response>();
    harness.request.mockReturnValueOnce(pending.promise);
    checkAll();
    const save = button(SAVE_LABEL)!.props.onClick!;
    const decline = button(DECLINE_LABEL)!.props.onClick!;
    save();
    save();
    decline();
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(harness.request.mock.calls[0]![1].method).toBe('POST');
    pending.resolve(response(receipt()));
    await vi.waitFor(() => expect(live()).toBeDefined());
    expect(harness.push).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 500])(
    'keeps capture off after a %s and supports an explicit retry',
    async (status) => {
      harness.request.mockResolvedValueOnce(response({ error: 'server-internal-secret' }, status));
      checkAll();
      click(SAVE_LABEL);
      await vi.waitFor(() => expect(alerts()).toHaveLength(1));
      expect(live()).toBeUndefined();
      expect(text(render())).not.toContain('server-internal-secret');
      expect(checkboxes().every((checkbox) => checkbox.props.checked)).toBe(true);
      expect(button(SAVE_LABEL)?.props.disabled).toBe(false);
      click(SAVE_LABEL);
      await vi.waitFor(() => expect(live()).toBeDefined());
      expect(harness.request).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ['missing snapshot', () => ({ id: SESSION_ID, status: 'SCHEDULED' })],
    ['wrong session', () => ({ ...receipt(), id: 'another-session' })],
    ['already started', () => ({ ...receipt(), status: 'IN_PROGRESS' })],
    [
      'incomplete scopes',
      () => {
        const body = receipt();
        body.consentSnapshot.entries.pop();
        return body;
      },
    ],
    [
      'invalid timestamp',
      () => {
        const body = receipt();
        body.consentSnapshot.entries[0]!.ackedAt = 'not-a-timestamp';
        return body;
      },
    ],
    [
      'invalid script revision',
      () => {
        const body = receipt();
        body.consentSnapshot.entries[0]!.scriptVersion = 'invalid';
        return body;
      },
    ],
  ])('rejects a successful HTTP response with %s', async (_label, invalidReceipt) => {
    harness.request.mockResolvedValueOnce(response(invalidReceipt()));
    checkAll();
    click(SAVE_LABEL);
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    expect(live()).toBeUndefined();
    expect(button(SAVE_LABEL)?.props.disabled).toBe(false);
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(harness.microphone).not.toHaveBeenCalled();
  });

  it('fails closed on unreadable JSON and network errors without leaking internal text', async () => {
    harness.request
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockRejectedValueOnce(new Error('server-internal-secret'));
    checkAll();
    click(SAVE_LABEL);
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    expect(live()).toBeUndefined();
    click(SAVE_LABEL);
    await vi.waitFor(() => {
      expect(harness.request).toHaveBeenCalledTimes(2);
      expect(button(SAVE_LABEL)?.props.disabled).toBe(false);
      expect(alerts()).toHaveLength(1);
    });
    expect(live()).toBeUndefined();
    expect(text(render())).not.toContain('server-internal-secret');
  });

  it('records refusal before navigating and cannot race refusal with agreement', async () => {
    const pending = deferred<Response>();
    harness.request.mockReturnValueOnce(pending.promise);
    checkAll();
    const save = button(SAVE_LABEL)!.props.onClick!;
    const decline = button(DECLINE_LABEL)!.props.onClick!;
    decline();
    decline();
    save();
    expect(harness.request).toHaveBeenCalledTimes(1);
    expect(harness.request.mock.calls[0]![0]).toBe(`/api/v1/sessions/${SESSION_ID}/consent`);
    expect(harness.request.mock.calls[0]![1].method).toBe('DELETE');
    expect(harness.push).not.toHaveBeenCalled();
    expect(live()).toBeUndefined();
    expect(
      elements(render())
        .filter((element) => element.type === 'button')
        .every((element) => element.props.disabled),
    ).toBe(true);
    pending.resolve(response({ ...receipt(), consentSnapshot: { entries: [], notes: null } }));
    await vi.waitFor(() =>
      expect(harness.push).toHaveBeenCalledWith(
        `/app/patients/fictional-client/encounters/${SESSION_ID}?mode=dictate&liveConsent=declined`,
      ),
    );
    expect(live()).toBeUndefined();
    expect(harness.microphone).not.toHaveBeenCalled();
  });

  it('does not navigate when refusal cannot be saved', async () => {
    harness.request.mockResolvedValueOnce(response({ error: 'server-internal-secret' }, 409));
    click(DECLINE_LABEL);
    await vi.waitFor(() => expect(alerts()).toHaveLength(1));
    expect(harness.push).not.toHaveBeenCalled();
    expect(live()).toBeUndefined();
    expect(text(render())).not.toContain('server-internal-secret');
    expect(button(DECLINE_LABEL)?.props.disabled).toBe(false);
  });

  it('shows the context flash before unchecked consent without saving or starting', () => {
    currentProps.showFlash = true;
    const flash = elements(render()).find((element) => element.type === 'context-flash');
    expect(flash).toBeDefined();
    expect(live()).toBeUndefined();
    expect(checkboxes()).toHaveLength(0);
    flash!.props.onDone!();
    expect(checkboxes()).toHaveLength(3);
    expect(checkboxes().every((checkbox) => checkbox.props.checked === false)).toBe(true);
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.microphone).not.toHaveBeenCalled();
  });

  it('preserves IN_PROGRESS entry without a new consent write or auto-start', () => {
    currentProps = { ...props(), sessionStatus: 'IN_PROGRESS', showFlash: true };
    expect(live()?.props).toMatchObject({ sessionId: SESSION_ID, autoStart: false });
    expect(checkboxes()).toHaveLength(0);
    expect(harness.request).not.toHaveBeenCalled();
    expect(harness.microphone).not.toHaveBeenCalled();
    expect(harness.socket).not.toHaveBeenCalled();
  });

  it.each(['save', 'decline'])(
    'aborts pending %s and ignores success after unmount',
    async (choice) => {
      const pending = deferred<Response>();
      harness.request.mockReturnValueOnce(pending.promise);
      if (choice === 'save') checkAll();
      click(choice === 'save' ? SAVE_LABEL : DECLINE_LABEL);
      const signal = harness.request.mock.calls[0]![1].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      unmount();
      const stateAtUnmount = structuredClone(harness.states);
      expect(signal.aborted).toBe(true);
      pending.resolve(response(receipt()));
      await new Promise((done) => setTimeout(done, 0));
      expect(harness.states).toEqual(stateAtUnmount);
      expect(harness.push).not.toHaveBeenCalled();
      expect(harness.microphone).not.toHaveBeenCalled();
    },
  );

  it('keys each encounter separately and never primes the microphone at Scribe entry points', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/app/patients/[id]/encounters/[sessionId]/live/page.tsx'),
      'utf8',
    );
    expect(page).toMatch(/<LiveEncounterFlow\s+key=\{sessionId\}/);
    for (const path of [
      'components/app/ClinicBoard.tsx',
      'components/app/StartEncounterButton.tsx',
    ]) {
      const entry = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(entry).not.toContain('primeMicPermission');
      expect(entry).not.toContain('getUserMedia');
    }
  });
});
