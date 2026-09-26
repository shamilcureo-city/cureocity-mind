import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { RxPadDraftSchema, type RxPadDraft, type RxPadPatchOp } from '@cureocity/contracts';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  callbacks: [] as { deps: readonly unknown[]; callback: unknown }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  callbackIndex: 0,
  request: vi.fn(),
  changed: vi.fn(),
  blockers: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (previous: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useCallback: <T>(callback: T, deps: readonly unknown[]) => {
    const index = h.callbackIndex++;
    const previous = h.callbacks[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      h.callbacks[index] = { callback, deps };
    return h.callbacks[index].callback;
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('../components/app/ScribeTransport', () => ({ useScribeFetch: () => h.request }));
vi.mock('../components/app/ScribeFavorites', () => ({ ScribeFavorites: 'favorites' }));
vi.mock('../components/app/VoicePlanEditor', () => ({ VoicePlanEditor: 'voice-editor' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/ui/Badge', () => ({ Badge: 'span' }));
vi.mock('../components/ui/Field', () => ({ Input: 'input', Label: 'label' }));
import { PlanComposer } from '../components/app/PlanComposer';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  pad?: RxPadDraft | null;
  editSeq?: number;
  onClick?: () => void;
  onApply?: (ops: RxPadPatchOp[]) => Promise<boolean>;
};
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
let props: Parameters<typeof PlanComposer>[0];
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = 0;
  const view = PlanComposer(props);
  h.queued.splice(0).forEach((run) => run());
  return view;
}
const control = (type: string) => elements(render()).find((item) => item.type === type);
const initial = () =>
  RxPadDraftSchema.parse({ version: 'V1', adviceLines: ['Fictional original advice'] });
const ops: RxPadPatchOp[] = [{ op: 'addAdvice', source: 'manual', text: 'Fictional new advice' }];
const patches = () => h.request.mock.calls.filter(([, init]) => init?.method === 'PATCH');
async function loaded(pad = initial()) {
  h.request.mockResolvedValueOnce(Response.json({ rxPad: pad, signed: false }));
  render();
  await vi.waitFor(() => expect(control('favorites')).toBeDefined());
}
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.callbacks = [];
  h.queued = [];
  props = {
    sessionId: 'session-1',
    signed: false,
    copilotActive: false,
    onPadChange: h.changed,
    onSignBlockers: h.blockers,
  };
  vi.stubGlobal('React', React);
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('prescription composer reviewed snapshot gates', () => {
  it.each(['http', 'malformed', 'network'] as const)(
    'does not expose mutation controls or send PATCH after %s initial load failure',
    async (failure) => {
      if (failure === 'network') h.request.mockRejectedValueOnce(new Error('offline'));
      else
        h.request.mockResolvedValueOnce(
          failure === 'http'
            ? Response.json({}, { status: 503 })
            : Response.json({ notAPad: true }),
        );
      render();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(control('favorites')).toBeUndefined();
      expect(control('voice-editor')).toBeUndefined();
      expect(patches()).toHaveLength(0);
      expect(h.changed).not.toHaveBeenCalled();
      expect(text(render())).toContain('Retry loading prescription');
    },
  );
  it('retries failed initial loading without permitting edits until a valid response arrives', async () => {
    h.request.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    render();
    await vi.waitFor(() => expect(text(render())).toContain('Retry loading prescription'));
    h.request.mockResolvedValueOnce(Response.json({ rxPad: initial(), signed: false }));
    elements(render()).find(
      (item) =>
        item.type === 'button' && text(item.props.children) === 'Retry loading prescription',
    )!.props.onClick!();
    render();
    expect(control('favorites')).toBeUndefined();
    await vi.waitFor(() => expect(control('favorites')).toBeDefined());
    expect(text(render())).not.toContain('Could not load the current prescription');
    expect(patches()).toHaveLength(0);
  });
  it('sends the exact loaded pad and advances the expected snapshot only after a successful response', async () => {
    await loaded();
    const next = {
      ...initial(),
      adviceLines: ['Fictional original advice', 'Fictional new advice'],
    };
    h.request.mockResolvedValueOnce(Response.json({ rxPad: next, signed: false }));
    expect(await control('favorites')!.props.onApply!(ops)).toBe(true);
    expect(JSON.parse(patches()[0][1].body as string)).toEqual({ ops, expectedPad: initial() });
    h.request.mockResolvedValueOnce(Response.json({ rxPad: next, signed: false }));
    await control('favorites')!.props.onApply!([
      { op: 'removeAdvice', text: 'Fictional new advice' },
    ]);
    expect(JSON.parse(patches()[1][1].body as string).expectedPad).toEqual(next);
  });
  it('does not retry a stale mutation, refreshes 409 state, and updates prescription sign blockers', async () => {
    await loaded();
    const refreshed = RxPadDraftSchema.parse({
      version: 'V1',
      meds: [{ drug: 'Fictional pending drug', status: 'pending' }],
    });
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'Changed in another window' }, { status: 409 }),
    );
    h.request.mockResolvedValueOnce(Response.json({ rxPad: refreshed, signed: false }));
    expect(await control('favorites')!.props.onApply!(ops)).toBe(false);
    expect(patches()).toHaveLength(1);
    expect(h.request.mock.calls.at(-1)).toEqual([
      '/api/v1/sessions/session-1/rx-pad',
      { cache: 'no-store' },
    ]);
    expect(control('favorites')!.props.pad).toEqual(refreshed);
    expect(h.blockers).toHaveBeenLastCalledWith({ hard: [], soft: ['Fictional pending drug'] });
    expect(h.changed.mock.calls.at(-1)?.[1]?.meds ?? []).toEqual([]);
    expect(text(render())).toContain('Changed in another window');
    h.request.mockResolvedValueOnce(Response.json({ rxPad: refreshed, signed: false }));
    await control('favorites')!.props.onApply!(ops);
    expect(JSON.parse(patches()[1][1].body as string).expectedPad).toEqual(refreshed);
  });
  it('rejects a sign-race mutation without an automatic retry', async () => {
    await loaded();
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'Prescription is already signed' }, { status: 409 }),
    );
    h.request.mockResolvedValueOnce(Response.json({ rxPad: initial(), signed: true }));
    expect(await control('favorites')!.props.onApply!(ops)).toBe(false);
    expect(patches()).toHaveLength(1);
    expect(text(render())).toContain('Prescription is already signed');
    expect(control('favorites')).toBeUndefined();
    expect(control('voice-editor')).toBeUndefined();
    expect(text(render())).toContain('signed — read-only');
  });
  it('keeps a server-signed initial load read-only even before the parent receives signed status', async () => {
    h.request.mockResolvedValueOnce(Response.json({ rxPad: initial(), signed: true }));
    render();
    await vi.waitFor(() => expect(text(render())).toContain('signed — read-only'));
    expect(control('favorites')).toBeUndefined();
    expect(control('voice-editor')).toBeUndefined();
    expect(patches()).toHaveLength(0);
  });
  it('keeps voice editing available by default and removes only voice editing for a fictional preview', async () => {
    await loaded();
    expect(control('voice-editor')).toBeDefined();
    props.voiceEditingEnabled = false;
    expect(control('voice-editor')).toBeUndefined();
    expect(control('favorites')).toBeDefined();
    props.signed = true;
    expect(control('favorites')).toBeUndefined();
    expect(control('voice-editor')).toBeUndefined();
  });
});
