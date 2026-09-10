import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  type MindConsentRecoveryInput,
  type MindConsentRecoveryReceipt,
  type MindConsentRecoveryState,
} from './mind-consent-recovery';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  load: vi.fn(),
  save: vi.fn(),
  guard: vi.fn(),
  confirmed: vi.fn(),
  openSession: vi.fn(),
  microphone: vi.fn(),
  request: vi.fn(),
  uuid: vi.fn(),
}));

// Run the real component's rendered controls with deterministic React hook
// state. This checks interaction/state wiring, not DOM focus or browser media.
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
vi.mock('./mind-consent-recovery-client', async (original) => ({
  ...(await original<typeof import('./mind-consent-recovery-client')>()),
  loadConsentRecovery: harness.load,
  saveConsentRecovery: harness.save,
}));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: harness.guard }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));

import { MindConsentRecovery } from '../components/app/MindConsentRecovery';
import { ConsentRecoveryRequestError } from './mind-consent-recovery-client';

type ElementProps = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { checked: boolean } }) => void;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
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
  const view = MindConsentRecovery({
    sessionId: 'same-session',
    onConfirmed: harness.confirmed,
    onOpenSession: harness.openSession,
  });
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
function checkAll() {
  const fieldset = elements(render()).find((element) => element.type === 'fieldset');
  expect(fieldset?.props.disabled).not.toBe(true);
  for (const checkbox of checkboxes()) checkbox.props.onChange!({ target: { checked: true } });
}
async function loaded() {
  render();
  await vi.waitFor(() => expect(checkboxes()).toHaveLength(3));
}
const missingState = (): MindConsentRecoveryState => ({
  sessionId: 'same-session',
  status: 'IN_PROGRESS',
  revision: 'a'.repeat(64),
  scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  scopes: MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
    scope,
    sessionAcknowledged: scope !== 'CROSS_BORDER_PROCESSING',
    standingStatus: 'GRANTED',
  })),
  ready: false,
});
const readyState = (): MindConsentRecoveryState => ({
  ...missingState(),
  revision: 'b'.repeat(64),
  scopes: MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
    scope,
    sessionAcknowledged: true,
    standingStatus: 'GRANTED',
  })),
  ready: true,
});
const receipt = (input: MindConsentRecoveryInput): MindConsentRecoveryReceipt => ({
  ...readyState(),
  operationId: input.operationId,
  replayed: false,
});

beforeEach(() => {
  vi.resetAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  harness.load.mockResolvedValue(missingState());
  harness.save.mockImplementation(async (_sessionId, input: MindConsentRecoveryInput) =>
    receipt(input),
  );
  harness.uuid
    .mockReturnValueOnce('e5f558db-c458-4c36-a39e-e872f39feb37')
    .mockReturnValueOnce('f73bb2b0-0ff9-4b9c-a9a5-28d282b72725');
  harness.request.mockRejectedValue(new Error('No network is permitted in this component test'));
  vi.stubGlobal('React', React);
  vi.stubGlobal('crypto', { randomUUID: harness.uuid });
  vi.stubGlobal('fetch', harness.request);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: harness.microphone } });
  vi.stubGlobal('window', { confirm: vi.fn(() => false) });
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  expect(harness.microphone).not.toHaveBeenCalled();
  expect(harness.request).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('mounted Mind consent recovery control wiring (no media or HTTP)', () => {
  it('starts with all three permissions unchecked and Save disabled despite standing consent', async () => {
    await loaded();
    expect(checkboxes().map((checkbox) => checkbox.props.checked)).toEqual([false, false, false]);
    expect(button('Save consent confirmation')?.props.disabled).toBe(true);
    expect(harness.load).toHaveBeenCalledWith('same-session', expect.any(AbortSignal));
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.confirmed).not.toHaveBeenCalled();
    expect(text(render())).toContain('Recording is off');
    expect(text(render())).toContain('It does not authorize earlier recording or processing');
  });

  it('only returns to the controls after all three checks and acknowledged save, never starts capture or navigates', async () => {
    await loaded();
    let resolve!: (value: MindConsentRecoveryReceipt) => void;
    harness.save.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    checkAll();
    expect(button('Save consent confirmation')?.props.disabled).toBe(false);
    click('Save consent confirmation');
    expect(harness.save).toHaveBeenCalledOnce();
    expect(harness.confirmed).not.toHaveBeenCalled();
    expect(button('Saving confirmation…')?.props.disabled).toBe(true);
    expect(elements(render()).find((element) => element.type === 'fieldset')?.props.disabled).toBe(
      true,
    );
    const [sessionId, input] = harness.save.mock.calls[0]!;
    expect(sessionId).toBe('same-session');
    expect(input).toEqual({
      operationId: 'e5f558db-c458-4c36-a39e-e872f39feb37',
      expectedRevision: 'a'.repeat(64),
      confirmations: {
        AUDIO_RECORDING: true,
        AI_NOTE_GENERATION: true,
        CROSS_BORDER_PROCESSING: true,
      },
    });
    resolve(receipt(input));
    await vi.waitFor(() => expect(harness.confirmed).toHaveBeenCalledOnce());
    expect(harness.openSession).not.toHaveBeenCalled();
    expect(checkboxes().every((checkbox) => checkbox.props.checked === false)).toBe(true);
  });

  it('keeps all choices after a lost acknowledgement and retries the exact same operation', async () => {
    await loaded();
    harness.save.mockRejectedValueOnce(new TypeError('Acknowledgement lost'));
    checkAll();
    click('Save consent confirmation');
    await vi.waitFor(() => expect(text(render())).toContain('Your choices are still here'));
    expect(checkboxes().map((checkbox) => checkbox.props.checked)).toEqual([true, true, true]);
    expect(harness.confirmed).not.toHaveBeenCalled();
    const originalInput = harness.save.mock.calls[0]![1];
    click('Retry consent confirmation');
    await vi.waitFor(() => expect(harness.confirmed).toHaveBeenCalledOnce());
    expect(harness.save.mock.calls[1]![1]).toBe(originalInput);
    expect(harness.uuid).toHaveBeenCalledOnce();
    expect(harness.load).toHaveBeenCalledOnce();
  });

  it('locks confirmation after 409, then reloads and requires fresh checks and a new operation', async () => {
    await loaded();
    harness.save.mockRejectedValueOnce(
      new ConsentRecoveryRequestError('Consent changed. Reload.', true),
    );
    checkAll();
    click('Save consent confirmation');
    await vi.waitFor(() => expect(button('Reload consent details')).toBeDefined());
    expect(elements(render()).find((element) => element.type === 'fieldset')?.props.disabled).toBe(
      true,
    );
    expect(button('Retry consent confirmation')).toBeUndefined();
    expect(harness.confirmed).not.toHaveBeenCalled();
    harness.load.mockResolvedValueOnce({ ...missingState(), revision: 'c'.repeat(64) });
    click('Reload consent details');
    render();
    await vi.waitFor(() => {
      expect(harness.load).toHaveBeenCalledTimes(2);
      expect(checkboxes().map((checkbox) => checkbox.props.checked)).toEqual([false, false, false]);
    });
    expect(button('Save consent confirmation')?.props.disabled).toBe(true);
    checkAll();
    click('Save consent confirmation');
    await vi.waitFor(() => expect(harness.confirmed).toHaveBeenCalledOnce());
    const retriedInput = harness.save.mock.calls[1]![1];
    expect(retriedInput.operationId).not.toBe(harness.save.mock.calls[0]![1].operationId);
    expect(retriedInput.expectedRevision).toBe('c'.repeat(64));
    expect(harness.openSession).not.toHaveBeenCalled();
  });

  it('returns to recording controls after an already-ready GET without any consent POST', async () => {
    harness.load.mockResolvedValue(readyState());
    render();
    await vi.waitFor(() => expect(button('Return to recording controls')).toBeDefined());
    expect(checkboxes()).toHaveLength(0);
    expect(harness.confirmed).not.toHaveBeenCalled();
    click('Return to recording controls');
    expect(harness.confirmed).toHaveBeenCalledOnce();
    expect(harness.save).not.toHaveBeenCalled();
    expect(harness.openSession).not.toHaveBeenCalled();
    expect(harness.uuid).not.toHaveBeenCalled();
  });
});
