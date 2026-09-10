import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { MindManualNoteFieldsSchema } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  callbacks: [] as { value: unknown; deps: readonly unknown[] }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  callbackIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
  sign: vi.fn(),
}));
// Exercise the real controls and async handlers. This does not substitute for
// a browser test of layout, DOM focus, passkeys or a real PDF renderer.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
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
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useCallback: <T>(value: T, deps: readonly unknown[]) => {
    const index = harness.callbackIndex++;
    const previous = harness.callbacks[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      harness.callbacks[index] = { value, deps };
    return harness.callbacks[index].value;
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
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
vi.mock('@/lib/sign-note', () => ({ postSignNote: harness.sign }));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: vi.fn() }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/app/MindSessionAgreements', () => ({ MindSessionAgreements: 'aside' }));
vi.mock('../components/app/ScheduleSessionPanel', () => ({ ScheduleSessionPanel: 'aside' }));
import { MindManualSession } from '../components/app/MindManualSession';

type Props = { children?: ReactNode; onClick?: () => Promise<void> | void; disabled?: boolean };
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
function render() {
  harness.stateIndex = harness.refIndex = harness.callbackIndex = harness.effectIndex = 0;
  const view = MindManualSession({
    sessionId: 'fictional-session',
    clientId: 'fictional-client',
    clientName: 'Fictional client',
    canShare: false,
  });
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function button(label: string) {
  return elements(render()).find((el) => el.type === 'button' && text(el.props.children) === label);
}
async function click(label: string) {
  const action = button(label);
  expect(action, `Missing action: ${label}`).toBeDefined();
  expect(action!.props.disabled).not.toBe(true);
  await action!.props.onClick!();
}
const state = (signed = false) => ({
  sessionId: 'fictional-session',
  kind: 'TREATMENT',
  purpose: 'COUNSELLING',
  status: 'COMPLETED',
  revision: 1,
  noteUpdatedAt: '2026-09-10T10:00:00.000Z',
  fields: MindManualNoteFieldsSchema.parse({ subjective: 'Fictional session note.' }),
  hasUnappliedDraft: false,
  note: { version: 'V1' },
  signed,
  signedAt: signed ? '2026-09-10T11:00:00.000Z' : null,
});
async function load(signed = false) {
  harness.request.mockResolvedValueOnce(Response.json(state(signed)));
  render();
  await vi.waitFor(() =>
    expect(button(signed ? 'Reopen to make a correction' : 'Sign this note')).toBeDefined(),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.callbacks = [];
  harness.effects = [];
  harness.queued = [];
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
  harness.request.mockRejectedValue(new Error('Connection lost'));
  harness.sign.mockResolvedValue(Response.json({ id: 'fictional-note' }, { status: 201 }));
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('manual-note signing and reopening refresh boundary', () => {
  it('blocks stale edit/sign controls and omits success copy when the post-sign refresh fails', async () => {
    await load();
    await click('Sign this note');
    expect(button('Sign this note')).toBeUndefined();
    expect(button('Edit note')).toBeUndefined();
    expect(button('Reload saved version')).toBeDefined();
    expect(text(render())).not.toContain('Your clinical note is signed.');
    expect(text(render())).not.toContain('Download signed PDF');
  });
  it('recovers a committed signature after a lost POST response without posting a duplicate', async () => {
    await load();
    harness.sign.mockRejectedValueOnce(new Error('Response lost'));
    await click('Sign this note');
    harness.request.mockResolvedValueOnce(Response.json(state(true)));
    await click('Reload saved version');
    await vi.waitFor(() => expect(text(render())).toContain('Download signed PDF'));
    expect(button('Sign this note')).toBeUndefined();
    expect(harness.sign).toHaveBeenCalledTimes(1);
  });
  it('confirms signing only after reading the locked signed note', async () => {
    await load();
    harness.request.mockResolvedValueOnce(Response.json(state(true)));
    await click('Sign this note');
    expect(text(render())).toContain('Your clinical note is signed. Nothing has been shared.');
    expect(text(render())).toContain('Download signed PDF');
  });
  it('does not claim a signature if another tab already reopened the note before refresh', async () => {
    await load();
    harness.request.mockResolvedValueOnce(Response.json(state(false)));
    await click('Sign this note');
    expect(text(render())).not.toContain('Your clinical note is signed.');
    expect(button('Edit note')).toBeDefined();
  });
  it('hides the stale signed PDF and correction action when post-unlock refresh fails', async () => {
    await load(true);
    harness.request.mockResolvedValueOnce(Response.json({ ok: true }));
    await click('Reopen to make a correction');
    expect(text(render())).not.toContain('Download signed PDF');
    expect(button('Reopen to make a correction')).toBeUndefined();
    expect(button('Save draft')).toBeUndefined();
    expect(button('Reload saved version')).toBeDefined();
  });
  it('opens correction fields only after verifying the note is unlocked', async () => {
    await load(true);
    harness.request
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json(state(false)));
    await click('Reopen to make a correction');
    expect(button('Save draft')).toBeDefined();
    expect(text(render())).not.toContain('Download signed PDF');
  });
  it('recovers an aborted signing request through a verified reload without signing twice', async () => {
    await load();
    const realSign = await vi.importActual<typeof import('./sign-note')>('./sign-note');
    harness.sign.mockImplementationOnce(realSign.postSignNote);
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
    harness.request.mockImplementationOnce((_, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
      );
    });

    const pending = click('Sign this note');
    await vi.waitFor(() => expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000));
    expect(button('Reload saved version')?.props.disabled).toBe(true);
    controller.abort(new DOMException('Request deadline elapsed', 'TimeoutError'));
    await pending;
    expect(button('Reload saved version')?.props.disabled).toBe(false);
    expect(button('Edit note')).toBeUndefined();
    expect(button('Sign this note')).toBeUndefined();
    expect(text(render())).not.toContain('Download signed PDF');

    harness.request.mockResolvedValueOnce(Response.json(state(true)));
    await click('Reload saved version');
    await vi.waitFor(() => expect(text(render())).toContain('Download signed PDF'));
    expect(harness.sign).toHaveBeenCalledTimes(1);
    expect(
      harness.request.mock.calls.filter(([url]) => String(url).endsWith('/sign')),
    ).toHaveLength(1);
  });
  it('recovers an aborted reopen request without exposing an obsolete signed note', async () => {
    await load(true);
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(controller.signal);
    harness.request.mockImplementationOnce((_, init: RequestInit) => {
      expect(init.signal).toBe(controller.signal);
      return new Promise((_, reject) =>
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
      );
    });

    const pending = click('Reopen to make a correction');
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000);
    expect(button('Reload saved version')?.props.disabled).toBe(true);
    controller.abort(new DOMException('Request deadline elapsed', 'TimeoutError'));
    await pending;
    expect(button('Reload saved version')?.props.disabled).toBe(false);
    expect(button('Reopen to make a correction')).toBeUndefined();
    expect(button('Save draft')).toBeUndefined();
    expect(text(render())).not.toContain('Download signed PDF');

    harness.request.mockResolvedValueOnce(Response.json(state(false)));
    await click('Reload saved version');
    await vi.waitFor(() => expect(button('Edit note')).toBeDefined());
    await click('Edit note');
    expect(button('Save draft')).toBeDefined();
    expect(text(render())).not.toContain('Download signed PDF');
    expect(
      harness.request.mock.calls.filter(([url]) => String(url).endsWith('/unlock')),
    ).toHaveLength(1);
  });
});
