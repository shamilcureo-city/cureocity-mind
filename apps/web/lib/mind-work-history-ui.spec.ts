import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  frames: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'history-test',
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (next: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof next === 'function' ? (next as (previous: T) => T)(h.states[index] as T) : next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || !deps || deps.some((value, i) => value !== previous.deps?.[i]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('next/link', () => ({ default: 'a' }));
import { MindWorkHistory } from '../components/app/MindWorkHistory';

type Props = {
  children?: ReactNode;
  id?: string;
  hidden?: boolean;
  role?: string;
  disabled?: boolean;
  href?: string;
  'aria-expanded'?: boolean;
  onClick?: () => void;
  ref?: { current: { focus: ReturnType<typeof vi.fn> } | null };
};
function children(element: ReactElement<Props>): ReactNode {
  return typeof element.type === 'function' && element.type.name === 'RecordedWork'
    ? (element.type as (props: unknown) => ReactNode)(element.props)
    : element.props.children;
}
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(children(child))] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(children(child)) : String(child)))
    .join('');
}
function render(clientId = 'client-a', runEffects = true) {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const view = MindWorkHistory({ clientId, request: h.request });
  for (const element of elements(view))
    if (element.props.ref && !element.props.ref.current)
      element.props.ref.current = { focus: vi.fn() };
  if (runEffects) h.queued.splice(0).forEach((run) => run());
  return view;
}
function button(label: string, view = render()) {
  return elements(view).find(
    (element) => element.type === 'button' && text(element.props.children) === label,
  );
}
function click(label: string) {
  const target = button(label);
  expect(target, `Missing ${label}`).toBeDefined();
  expect(target!.props.disabled).not.toBe(true);
  target!.props.onClick!();
}
function work(version: number, sessionId = 'visit-a', wording = `work-v${version}`) {
  return {
    recordVersion: version,
    savedAt: '2026-09-14T09:00:00.000Z',
    work: {
      sessionId,
      scheduledAt: '2026-09-08T09:00:00.000Z',
      disposition: 'ADAPTED',
      workDone: wording,
      clientResponse: '',
    },
  };
}
const first = (changes: Record<string, unknown> = {}) => ({
  clientId: 'client-a',
  snapshotVersion: 75,
  beforeVersion: null,
  nextBeforeVersion: 51,
  entries: [work(70), work(60, 'visit-b')],
  hasMore: true,
  ...changes,
});
const middle = () => first({ beforeVersion: 51, nextBeforeVersion: 26, entries: [] });
const last = () =>
  first({
    beforeVersion: 26,
    nextBeforeVersion: null,
    entries: [work(20, 'visit-a', 'earlier-wording'), work(10, 'visit-c')],
    hasMore: false,
  });
async function loaded() {
  h.request.mockResolvedValueOnce(Response.json(first()));
  click('Work historyOpen');
  await vi.waitFor(() => expect(text(render())).toContain('work-v70'));
}

beforeEach(() => {
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  h.frames = [];
  h.request.mockReset();
  vi.stubGlobal('React', React);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
    h.frames.push(run);
    return h.frames.length;
  });
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('read-only Mind work history', () => {
  it('does not fetch on render, and opening is a GET rather than a record or clinical decision', async () => {
    expect(button('Work historyOpen')?.props['aria-expanded']).toBe(false);
    expect(h.request).not.toHaveBeenCalled();
    await loaded();
    expect(h.request).toHaveBeenCalledOnce();
    expect(h.request.mock.calls[0][1].method).toBe('GET');
    expect(text(render())).toContain('A scheduled date does not confirm attendance');
    expect(text(render())).toContain('care-record version 70');
    expect(text(render())).toContain('Visit scheduled');
    expect(text(render())).toContain('Saved');
    expect(text(render())).toContain('Not recorded; no response or improvement is inferred');
    expect(
      elements(render()).some((element) => element.props.href === '/app/sessions/visit-a?tab=note'),
    ).toBe(true);
    expect(h.frames).toHaveLength(0); // Opening does not move focus away from its trigger.
  });

  it('preserves newer wording, reports empty intermediate pages, and offers the next earlier range', async () => {
    await loaded();
    h.request.mockResolvedValueOnce(Response.json(middle()));
    click('Load earlier records');
    await vi.waitFor(() =>
      expect(text(render())).toContain(
        'No additional work changes in this range. Earlier records remain.',
      ),
    );
    expect(text(render())).toContain('work-v70');
    expect(button('Load earlier records')).toBeDefined();
    h.request.mockResolvedValueOnce(Response.json(last()));
    click('Load earlier records');
    await vi.waitFor(() => expect(text(render())).toContain('earlier-wording'));
    expect(text(render()).indexOf('work-v70')).toBeLessThan(
      text(render()).indexOf('earlier-wording'),
    );
    expect(text(render())).toContain('Earlier saved wording (1)');
    expect(button('Load earlier records')).toBeUndefined();
    expect(h.request.mock.calls[2][0]).toContain('snapshotVersion=75&beforeVersion=26');
  });

  it('keeps the earlier button mounted and disabled while loading, then focuses completion status', async () => {
    await loaded();
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    click('Load earlier records');
    expect(button('Load earlier records')?.props.disabled).toBe(true);
    finish(Response.json(middle()));
    await vi.waitFor(() => expect(text(render())).toContain('No additional work changes'));
    const status = elements(render()).find(
      (element) =>
        element.props.role === 'status' &&
        text(element.props.children).includes('No additional work changes'),
    )!;
    h.frames.splice(0).forEach((run) => run());
    expect(status.props.ref!.current!.focus).toHaveBeenCalledOnce();
  });

  it('does not focus hidden content when the user collapses during loading', async () => {
    await loaded();
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    click('Load earlier records');
    click('Work historyHide');
    render();
    finish(Response.json(middle()));
    await vi.waitFor(() => expect(text(render())).toContain('No additional work changes'));
    const status = elements(render()).find(
      (element) =>
        element.props.role === 'status' &&
        text(element.props.children).includes('No additional work changes'),
    )!;
    h.frames.splice(0).forEach((run) => run());
    expect(status.props.ref!.current!.focus).not.toHaveBeenCalled();
    expect(
      elements(render()).find((element) => element.props.id === 'history-test-content')?.props
        .hidden,
    ).toBe(true);
  });

  it('shows an honest partial-empty state and still permits earlier pages', async () => {
    h.request.mockResolvedValueOnce(Response.json(first({ entries: [] })));
    click('Work historyOpen');
    await vi.waitFor(() => expect(text(render())).toContain('Earlier records are still available'));
    expect(text(render())).not.toContain('No confirmed session work was found');
    expect(button('Load earlier records')).toBeDefined();
  });

  it('does not display version zero or imply a completed clinical record for an empty history', async () => {
    h.request.mockResolvedValueOnce(
      Response.json(
        first({ snapshotVersion: 0, nextBeforeVersion: null, entries: [], hasMore: false }),
      ),
    );
    click('Work historyOpen');
    await vi.waitFor(() => expect(text(render())).toContain('No confirmed session work was found'));
    expect(text(render())).not.toContain('version 0');
    expect(text(render())).not.toContain('fully loaded');
  });

  it('hides content on a network failure and retries exactly the failed cursor before restoring the base', async () => {
    await loaded();
    h.request.mockRejectedValueOnce(new TypeError('lost connection'));
    click('Load earlier records');
    await vi.waitFor(() => expect(button('Retry same page')).toBeDefined());
    expect(text(render())).not.toContain('work-v70');
    const failedUrl = h.request.mock.calls[1][0];
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    click('Retry same page');
    expect(button('Retry same page')?.props.disabled).toBe(true);
    expect(text(render())).not.toContain('work-v70');
    finish(Response.json(middle()));
    await vi.waitFor(() => expect(text(render())).toContain('work-v70'));
    expect(h.request.mock.calls[2][0]).toBe(failedUrl);
    expect(text(render())).toContain('No additional work changes');
  });

  it.each([403, 404, 503])(
    'purges earlier clinical content on HTTP %s and refreshes from a new snapshot',
    async (status) => {
      await loaded();
      h.request.mockResolvedValueOnce(Response.json({}, { status }));
      click('Load earlier records');
      await vi.waitFor(() => expect(text(render())).toContain('No history is shown'));
      expect(text(render())).not.toContain('work-v70');
      expect(button('Retry same page')).toBeUndefined();
      h.request.mockResolvedValueOnce(
        Response.json(
          first({ snapshotVersion: 0, nextBeforeVersion: null, entries: [], hasMore: false }),
        ),
      );
      click('Refresh history');
      await vi.waitFor(() =>
        expect(text(render())).toContain('No confirmed session work was found'),
      );
      expect(h.request.mock.calls[2][0]).toBe('/api/v1/clients/client-a/session-work-history');
      expect(text(render())).not.toContain('work-v70');
    },
  );

  it('purges content for a malformed or wrong-client continuation instead of showing a false empty state', async () => {
    await loaded();
    h.request.mockResolvedValueOnce(Response.json({ ...middle(), clientId: 'other-client' }));
    click('Load earlier records');
    await vi.waitFor(() =>
      expect(text(render())).toContain('Verified work history could not be loaded'),
    );
    expect(text(render())).not.toContain('work-v70');
    expect(text(render())).not.toContain('No confirmed session work was found');
  });

  it('blocks same-frame duplicate reads', async () => {
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const trigger = button('Work historyOpen')!;
    trigger.props.onClick!();
    trigger.props.onClick!();
    expect(h.request).toHaveBeenCalledOnce();
    finish(Response.json(first()));
    await vi.waitFor(() => expect(text(render())).toContain('work-v70'));
  });

  it('hides old-client data synchronously, rejects an old handler and ignores its late response', async () => {
    await loaded();
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    const oldButton = button('Load earlier records')!;
    oldButton.props.onClick!();
    const changed = render('client-b', false);
    expect(text(changed)).not.toContain('work-v70');
    expect(text(changed)).toContain('Previous work history is hidden');
    oldButton.props.onClick!();
    expect(h.request).toHaveBeenCalledTimes(2);
    h.queued.splice(0).forEach((run) => run());
    expect(h.request.mock.calls[1][1].signal.aborted).toBe(true);
    finish(Response.json(middle()));
    await Promise.resolve();
    await Promise.resolve();
    const fresh = render('client-b');
    expect(text(fresh)).not.toContain('work-v70');
    expect(button('Work historyOpen', fresh)).toBeDefined();
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('aborts on unmount and ignores a late settling response', async () => {
    let finish!: (response: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    click('Work historyOpen');
    h.effects.forEach((effect) => effect.cleanup?.());
    expect(h.request.mock.calls[0][1].signal.aborted).toBe(true);
    finish(Response.json(first()));
    await Promise.resolve();
    await Promise.resolve();
    expect(
      h.states.some(
        (state) => Array.isArray(state) && state.some((entry) => entry?.recordVersion === 70),
      ),
    ).toBe(false);
  });
});
