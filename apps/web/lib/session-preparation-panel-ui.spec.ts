import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
  pending: vi.fn(),
  dirty: vi.fn(),
  skip: vi.fn(),
  guard: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'preparation-test',
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T) => {
        h.states[index] = value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: h.guard }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import {
  SessionPreparationPanel,
  type SessionPreparationPanelProps,
} from '../components/app/SessionPreparationPanel';

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  role?: string;
  htmlFor?: string;
  maxLength?: number;
};
const all = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...all(child.props.children)] : [],
  );
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
let current: SessionPreparationPanelProps;
function render(flush = true) {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const outer = SessionPreparationPanel(current);
  const inner = outer.type as (props: SessionPreparationPanelProps) => ReactElement;
  const result = inner(outer.props);
  if (flush) h.queued.splice(0).forEach((run) => run());
  return result;
}
const button = (label: string) =>
  all(render()).find((node) => node.type === 'button' && text(node.props.children) === label);
const field = () => all(render()).find((node) => node.type === 'textarea');
function click(label: string) {
  const control = button(label);
  expect(control, `Missing ${label}`).toBeDefined();
  expect(control!.props.disabled).not.toBe(true);
  control!.props.onClick!();
}
const visit = () => ({
  sessionId: 'visit-1',
  clientId: 'client-1',
  scheduledAt: '2026-09-13T09:00:00.000Z',
  status: 'SCHEDULED',
  preparation: null,
});
function response(input: RequestInit) {
  const packet = JSON.parse(String(input.body));
  return {
    ...visit(),
    preparation: {
      id: 'preparation-1',
      sessionId: 'visit-1',
      psychologistId: 'psychologist-1',
      revision: packet.expectedRevision + 1,
      operationId: packet.operationId,
      body: {
        version: 1,
        focus: packet.focus,
        source: 'CLINICIAN_WRITTEN',
        scheduledAt: packet.expectedScheduledAt,
      },
      createdAt: '2026-09-13T09:00:00.000Z',
    },
    currentRevision: packet.expectedRevision + 1,
    replayed: false,
  };
}
async function load() {
  render();
  await vi.waitFor(() => expect(text(render())).not.toContain('Checking saved preparation'));
}
beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  vi.stubGlobal('React', React);
  h.request.mockImplementation(async (_url: string, input?: RequestInit) =>
    Response.json(input?.method === 'POST' ? response(input) : visit()),
  );
  current = {
    sessionId: 'visit-1',
    clientId: 'client-1',
    clientName: 'Fictional client',
    request: h.request,
    onPendingChange: h.pending,
    onDirtyChange: h.dirty,
  };
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('session preparation real control handlers (not a DOM or clinical validation)', () => {
  it('labels the exact visit, bounds input and only adopts after explicit acknowledgement', async () => {
    await load();
    expect(text(render())).toContain('Fictional client');
    expect(text(render())).toContain('13 Sept 2026');
    expect(field()?.props.maxLength).toBe(200);
    expect(all(render()).find((node) => node.type === 'label')?.props.htmlFor).toBe(
      field()?.props.id,
    );
    field()!.props.onChange!({ target: { value: 'Discuss sleep routine' } });
    expect(h.dirty).toHaveBeenLastCalledWith(true);
    expect(h.request.mock.calls.filter(([, input]) => input?.method === 'POST')).toHaveLength(0);
    click('Use for this visit');
    expect(h.pending).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(text(render())).toContain('Saved for this visit.'));
    expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.dirty).toHaveBeenLastCalledWith(false);
  });
  it('keeps pending save retry available after readOnly prop changes without loading or dropping receipt identity', async () => {
    await load();
    field()!.props.onChange!({ target: { value: 'Preserve wording' } });
    h.request.mockRejectedValueOnce(new Error('Lost response'));
    click('Use for this visit');
    await vi.waitFor(() => expect(button('Retry same save')).toBeDefined());
    const calls = h.request.mock.calls.length;
    current = { ...current, readOnly: true };
    render();
    expect(h.request).toHaveBeenCalledTimes(calls);
    expect(h.pending).toHaveBeenLastCalledWith(true);
    expect(field()?.props.value).toBe('Preserve wording');
    expect(field()?.props.readOnly).toBe(true);
    click('Retry same save');
    await vi.waitFor(() => expect(h.pending).toHaveBeenLastCalledWith(false));
    const posts = h.request.mock.calls.filter(([, input]) => input?.method === 'POST');
    expect(posts[0][1].body).toEqual(posts[1][1].body);
  });
  it('skips unsaved text explicitly without creating a preparation', async () => {
    current.onSkip = h.skip;
    await load();
    field()!.props.onChange!({ target: { value: 'Unadopted wording' } });
    click('Skip without saving');
    expect(h.skip).toHaveBeenCalledOnce();
    expect(h.dirty).toHaveBeenLastCalledWith(false);
    expect(h.request.mock.calls.filter(([, input]) => input?.method === 'POST')).toHaveLength(0);
  });
  it('prevents skip while an explicit save is ambiguous', async () => {
    current.onSkip = h.skip;
    await load();
    field()!.props.onChange!({ target: { value: 'Unresolved wording' } });
    h.request.mockRejectedValueOnce(new Error('Lost response'));
    click('Use for this visit');
    await vi.waitFor(() => expect(button('Retry same save')).toBeDefined());
    expect(button('Skip without saving')?.props.disabled).toBe(true);
    expect(h.guard).toHaveBeenLastCalledWith(true, expect.any(String), true);
  });
  it('read-only visits display preparation as non-evidence and omit editable controls', async () => {
    const stored = response({
      body: JSON.stringify({
        operationId: 'a6e4e83a-8507-4db2-ac68-1b70ff356859',
        expectedRevision: 0,
        expectedScheduledAt: visit().scheduledAt,
        focus: 'Saved fictional focus',
      }),
    });
    h.request.mockResolvedValueOnce(
      Response.json({ ...visit(), status: 'IN_PROGRESS', preparation: stored.preparation }),
    );
    await load();
    expect(text(render())).toContain('Saved fictional focus');
    expect(text(render())).toContain('Preparation — not evidence');
    expect(field()).toBeUndefined();
    expect(button('Use for this visit')).toBeUndefined();
  });
  it('shows a changed schedule warning even if text is unchanged and editable', async () => {
    const stored = response({
      body: JSON.stringify({
        operationId: 'a6e4e83a-8507-4db2-ac68-1b70ff356859',
        expectedRevision: 0,
        expectedScheduledAt: '2026-09-12T09:00:00.000Z',
        focus: 'Saved fictional focus',
      }),
    });
    h.request.mockResolvedValueOnce(Response.json({ ...visit(), preparation: stored.preparation }));
    await load();
    expect(field()?.props.readOnly).toBe(false);
    expect(text(render())).toContain('This visit’s scheduled time has since changed.');
    expect(button('Use for this visit')?.props.disabled).toBe(false);
  });
  it('unavailable source does not show empty or save controls, and retry can load the saved focus', async () => {
    h.request.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await load();
    expect(text(render())).toContain('not being treated as empty');
    expect(text(render())).not.toContain('No saved focus');
    expect(field()).toBeUndefined();
    const stored = response({
      body: JSON.stringify({
        operationId: 'a6e4e83a-8507-4db2-ac68-1b70ff356859',
        expectedRevision: 0,
        expectedScheduledAt: visit().scheduledAt,
        focus: 'Existing saved focus',
      }),
    });
    h.request.mockResolvedValueOnce(Response.json({ ...visit(), preparation: stored.preparation }));
    click('Retry preparation');
    await vi.waitFor(() => expect(field()?.props.value).toBe('Existing saved focus'));
  });
  it.each(['client', 'session'])(
    'hides old text immediately on a %s switch before effects run and uses a new React key',
    async (kind) => {
      await load();
      field()!.props.onChange!({ target: { value: 'Never display to the new context' } });
      const key = SessionPreparationPanel(current).key;
      current =
        kind === 'client'
          ? { ...current, clientId: 'client-2' }
          : { ...current, sessionId: 'visit-2' };
      expect(SessionPreparationPanel(current).key).not.toBe(key);
      const switched = render(false);
      expect(text(switched)).not.toContain('Never display');
      expect(text(switched)).toContain('Checking this visit’s preparation');
      expect(all(switched).find((node) => node.type === 'textarea')).toBeUndefined();
    },
  );
});
