import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  type ScribeNoteStyle,
} from './scribe-personalization-contracts';

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
  transport: undefined as unknown,
}));
vi.mock('react', () => ({
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T | ((old: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (old: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useCallback: (callback: unknown, deps: readonly unknown[]) => {
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
vi.mock('../components/app/ScribeTransport', () => ({ useScribeFetch: () => h.transport }));
import { useScribeNoteStyle } from './use-scribe-personalization';

const timestamp = '2026-09-26T10:00:00.000Z';
function changed(): ScribeNoteStyle {
  const style = structuredClone(DEFAULT_SCRIBE_NOTE_STYLE);
  style.firstVisit.labels.hpi = 'History';
  return style;
}
function record(body: ScribeNoteStyle = DEFAULT_SCRIBE_NOTE_STYLE, revision = 1) {
  return { id: 'note-style-doctor-1', revision, createdAt: timestamp, updatedAt: timestamp, body };
}
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = 0;
  const result = useScribeNoteStyle();
  h.queued.splice(0).forEach((run) => run());
  return result;
}
async function load(value: ReturnType<typeof record> | null = null) {
  h.request.mockResolvedValueOnce(Response.json({ record: value }));
  render();
  await vi.waitFor(() => expect(render().loaded).toBe(true));
  return render();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let events: EventTarget;
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.callbacks = [];
  h.queued = [];
  h.transport = h.request;
  h.request.mockImplementation(() => Promise.resolve(Response.json({ record: null })));
  events = new EventTarget();
  vi.stubGlobal('window', events);
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('note-style application persistence', () => {
  it('uses a server-confirmed empty preference as the default at revision zero', async () => {
    const result = await load();
    expect(result).toMatchObject({ style: DEFAULT_SCRIBE_NOTE_STYLE, revision: 0, loaded: true });
    expect(h.request).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/scribe/note-styles',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('does not save before the initial preference is loaded', async () => {
    h.request.mockReturnValueOnce(deferred<Response>().promise);
    expect(await render().save(changed())).toBe(false);
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('requires all seven presentation sections and refuses clinical text fields before sending', async () => {
    await load();
    const missing = changed();
    missing.firstVisit.order.pop();
    expect(await render().save(missing)).toBe(false);
    expect(
      await render().save({ ...changed(), assessment: 'Clinical assertion' } as ScribeNoteStyle),
    ).toBe(false);
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('persists normalized presentation only after an exact body and next revision acknowledgement', async () => {
    await load(record());
    const style = changed();
    h.request.mockResolvedValueOnce(Response.json({ record: record(style, 2) }));
    const dispatch = vi.spyOn(events, 'dispatchEvent');
    expect(await render().save(style)).toBe(true);
    expect(JSON.parse(h.request.mock.calls[1][1].body as string)).toEqual({
      revision: 1,
      body: style,
    });
    expect(render()).toMatchObject({ style, revision: 2, busy: false });
    expect(dispatch).toHaveBeenCalledOnce();
    // The saving instance ignores its own change event while the write is still active.
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing record', null],
    ['wrong revision', record(changed(), 3)],
    ['different style', record(DEFAULT_SCRIBE_NOTE_STYLE, 2)],
  ])('rejects a successful-looking save with %s', async (_name, ack) => {
    await load(record());
    const dispatch = vi.spyOn(events, 'dispatchEvent');
    h.request.mockResolvedValueOnce(Response.json({ record: ack }));
    expect(await render().save(changed())).toBe(false);
    expect(render()).toMatchObject({ style: DEFAULT_SCRIBE_NOTE_STYLE, revision: 1, busy: false });
    expect(render().error).toContain('not confirmed');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('retains the last verified style after reload or save failure without retrying', async () => {
    const style = changed();
    await load(record(style, 2));
    h.request.mockRejectedValueOnce(new Error('Offline'));
    await render().reload();
    expect(render()).toMatchObject({ style, revision: 2, error: 'Offline' });
    h.request.mockResolvedValueOnce(Response.json({ error: 'Conflict' }, { status: 409 }));
    expect(await render().save(DEFAULT_SCRIBE_NOTE_STYLE)).toBe(false);
    expect(render()).toMatchObject({ style, revision: 2, error: 'Conflict' });
    render();
    render();
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it('ignores an older reload that returns after a newer confirmed reload', async () => {
    await load();
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const oldReload = render().reload();
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    h.request.mockResolvedValueOnce(Response.json({ record: record(changed(), 4) }));
    await render().reload();
    expect(signal.aborted).toBe(true);
    delayed.resolve(Response.json({ record: record(DEFAULT_SCRIBE_NOTE_STYLE, 1) }));
    await oldReload;
    expect(render()).toMatchObject({ style: changed(), revision: 4 });
  });

  it('aborts an in-flight reload before saving and ignores its late result', async () => {
    await load(record());
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const reload = render().reload();
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    h.request.mockResolvedValueOnce(Response.json({ record: record(changed(), 2) }));
    expect(await render().save(changed())).toBe(true);
    expect(signal.aborted).toBe(true);
    delayed.resolve(Response.json({ record: record() }));
    await reload;
    expect(render()).toMatchObject({ style: changed(), revision: 2 });
  });

  it('serializes saves and suppresses explicit or event reloads while a save is pending', async () => {
    await load();
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const save = render().save(changed());
    expect(render().busy).toBe(true);
    expect(await render().save(DEFAULT_SCRIBE_NOTE_STYLE)).toBe(false);
    await render().reload();
    events.dispatchEvent(new Event('scribe-note-style-changed'));
    expect(h.request).toHaveBeenCalledTimes(2);
    delayed.resolve(Response.json({ record: record(changed(), 1) }));
    expect(await save).toBe(true);
    expect(render().busy).toBe(false);
  });

  it('hides old transport preferences immediately and ignores a late save from that context', async () => {
    await load(record(changed(), 4));
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const save = render().save(DEFAULT_SCRIBE_NOTE_STYLE);
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    const next = vi.fn().mockResolvedValue(Response.json({ record: null }));
    h.transport = next;
    expect(render()).toMatchObject({
      style: DEFAULT_SCRIBE_NOTE_STYLE,
      loaded: false,
      revision: 0,
    });
    expect(signal.aborted).toBe(true);
    delayed.resolve(Response.json({ record: record(DEFAULT_SCRIBE_NOTE_STYLE, 5) }));
    expect(await save).toBe(false);
    await vi.waitFor(() => expect(render().loaded).toBe(true));
    expect(render().revision).toBe(0);
  });

  it('removes listeners and aborts an active request when unmounted', () => {
    const remove = vi.spyOn(events, 'removeEventListener');
    h.request.mockReturnValueOnce(deferred<Response>().promise);
    render();
    const signal = h.request.mock.calls[0][1].signal as AbortSignal;
    h.effects.forEach((effect) => effect.cleanup?.());
    expect(signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('scribe-note-style-changed', expect.any(Function));
    events.dispatchEvent(new Event('scribe-note-style-changed'));
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('uses bounded request deadlines and no browser storage', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const localStorage = { setItem: vi.fn() },
      sessionStorage = { setItem: vi.fn() };
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    await load();
    h.request.mockResolvedValueOnce(Response.json({ record: record(changed(), 1) }));
    await render().save(changed());
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([12_000, 15_000]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });

  it('rejects a late response after its deadline instead of confirming the style save', async () => {
    await load(record());
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const save = render().save(changed());
    deadline.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
    delayed.resolve(Response.json({ record: record(changed(), 2) }));
    expect(await save).toBe(false);
    expect(render()).toMatchObject({ style: DEFAULT_SCRIBE_NOTE_STYLE, revision: 1, busy: false });
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('blocks retained callbacks after transport context changes', async () => {
    const previous = await load(record());
    const next = vi.fn().mockResolvedValue(Response.json({ record: null }));
    h.transport = next;
    render();
    expect(await previous.save(changed())).toBe(false);
    await previous.reload();
    expect(h.request).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
});
