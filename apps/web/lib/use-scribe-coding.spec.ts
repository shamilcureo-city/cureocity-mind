import { webcrypto } from 'node:crypto';
import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScribeCodingResponse, ScribeCodingWorksheet } from './scribe-coding';

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
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i])) {
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
    }
  },
}));
vi.mock('../components/app/ScribeTransport', () => ({ useScribeFetch: () => h.request }));
import { scribeCodingNoteHash, useScribeCoding } from './use-scribe-coding';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  assessment: 'Fictional assessment.',
});
const worksheet: ScribeCodingWorksheet = { version: 'V1', status: 'draft', entries: [] };
const reviewed: ScribeCodingWorksheet = { ...worksheet, status: 'reviewed' };
const initial = (): ScribeCodingResponse => ({
  draft: { id: 'draft-1', hash: 'a'.repeat(64), content: note },
  signed: false,
  signedNoteHash: null,
  record: null,
  sourceCurrent: null,
  suggestions: [],
});
async function saved(body: ScribeCodingWorksheet = worksheet): Promise<ScribeCodingResponse> {
  const review = body.status === 'reviewed';
  return {
    ...initial(),
    sourceCurrent: true,
    record: {
      id: 'coding-1',
      revision: 1,
      clientId: 'client-1',
      sessionId: 'session-1',
      createdAt: '2026-09-26T10:00:00.000Z',
      updatedAt: '2026-09-26T10:00:00.000Z',
      body: {
        worksheet: body,
        draftId: 'draft-1',
        draftHash: 'a'.repeat(64),
        reviewedNoteHash: review ? await scribeCodingNoteHash(note) : null,
        reviewedAt: review ? '2026-09-26T10:00:00.000Z' : null,
        reviewedBy: review ? 'doctor-1' : null,
      },
    },
  };
}
let props: Parameters<typeof useScribeCoding>[0];
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = 0;
  const result = useScribeCoding(props);
  h.queued.splice(0).forEach((run) => run());
  return result;
}
async function load() {
  render();
  await vi.waitFor(() => expect(render().state).not.toBeNull());
  return render();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.callbacks = [];
  h.queued = [];
  vi.stubGlobal('crypto', webcrypto);
  props = { sessionId: 'session-1', note, baseline: note, enabled: true, signed: false };
  h.request.mockResolvedValue(Response.json(initial()));
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('coding worksheet request lifecycle', () => {
  it('loads only when explicitly opened and uses private uncached requests', async () => {
    props.enabled = false;
    expect(render().state).toBeNull();
    expect(h.request).not.toHaveBeenCalled();
    props = { ...props, enabled: true };
    await load();
    expect(h.request).toHaveBeenCalledWith(
      '/api/v1/scribe/encounters/session-1/coding',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('hides another encounter immediately and ignores its delayed response', async () => {
    const old = deferred<Response>();
    h.request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json(initial()));
    render();
    const oldSignal = h.request.mock.calls[0][1].signal as AbortSignal;
    props = { ...props, sessionId: 'session-2' };
    expect(render().state).toBeNull();
    expect(oldSignal.aborted).toBe(true);
    await load();
    old.resolve(Response.json({ ...initial(), draft: { ...initial().draft, id: 'old-draft' } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().state?.draft.id).toBe('draft-1');
  });

  it('aborts pending reads on unmount', () => {
    h.request.mockReturnValue(new Promise(() => {}));
    render();
    const signal = h.request.mock.calls[0][1].signal as AbortSignal;
    h.effects.forEach((effect) => effect.cleanup?.());
    expect(signal.aborted).toBe(true);
  });

  it('rejects malformed and wrong-encounter responses', async () => {
    const record = await saved();
    record.record!.sessionId = 'different-session';
    h.request.mockResolvedValueOnce(Response.json(record));
    render();
    await vi.waitFor(() => expect(render().error).toContain('could not be verified'));
    expect(render().state).toBeNull();
    h.request.mockResolvedValueOnce(Response.json({ signed: false }));
    await render().reload();
    expect(render().state).toBeNull();
  });

  it('rejects saving when the loaded baseline differs without overwriting the note', async () => {
    const changed = initial();
    changed.draft.content = { ...note, assessment: 'New saved assessment.' };
    h.request.mockResolvedValueOnce(Response.json(changed));
    await load();
    expect(render().baselineChanged).toBe(true);
    expect(await render().save(worksheet)).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(props.note.assessment).toBe('Fictional assessment.');
  });

  it('saves only explicit client fields and waits for a matching persistence acknowledgement', async () => {
    await load();
    const acknowledgement = await saved(reviewed);
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const saving = render().save(reviewed);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(render().saving).toBe(true);
    const input = JSON.parse(h.request.mock.calls[1][1].body);
    expect(input).toEqual({
      expectedRevision: 0,
      draftHash: 'a'.repeat(64),
      workingNote: note,
      worksheet: reviewed,
    });
    expect(input.reviewedBy).toBeUndefined();
    expect(render().state?.record).toBeNull();
    pending.resolve(Response.json(acknowledgement));
    expect(await saving).toEqual(acknowledgement);
    expect(render().state?.record?.body.reviewedBy).toBe('doctor-1');
    expect(render().saving).toBe(false);
  });

  it('keeps the last saved state after a save error and does not retry automatically', async () => {
    h.request.mockResolvedValueOnce(Response.json(await saved()));
    await load();
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'The worksheet changed; reload.' }, { status: 409 }),
    );
    expect(await render().save(reviewed)).toBeNull();
    expect(render().error).toBe('The worksheet changed; reload.');
    expect(render().state?.record?.body.worksheet.status).toBe('draft');
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('refuses an acknowledgement for a different worksheet or reviewed note', async () => {
    await load();
    h.request.mockResolvedValueOnce(Response.json(await saved()));
    expect(await render().save(reviewed)).toBeNull();
    expect(render().error).toContain('not confirmed');
    const badHash = await saved(reviewed);
    badHash.record!.body.reviewedNoteHash = 'b'.repeat(64);
    h.request.mockResolvedValueOnce(Response.json(badHash));
    expect(await render().save(reviewed)).toBeNull();
    expect(render().state?.record).toBeNull();
  });

  it('serializes writes and refuses reload during an unconfirmed save', async () => {
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const save = render().save(worksheet);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(await render().save(worksheet)).toBeNull();
    await render().reload();
    expect(h.request).toHaveBeenCalledTimes(2);
    pending.resolve(Response.json(await saved()));
    await save;
  });

  it('cannot save after the encounter is signed', async () => {
    const response = initial();
    response.signed = true;
    response.signedNoteHash = 'b'.repeat(64);
    h.request.mockResolvedValueOnce(Response.json(response));
    await load();
    expect(await render().save(worksheet)).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(1);
  });

  it('changes the note review identity immediately without retaining a stale hash', async () => {
    await load();
    await vi.waitFor(() => expect(render().currentNoteHash).not.toBeNull());
    const previous = render().currentNoteHash;
    props = { ...props, note: { ...note, assessment: 'Changed clinical assessment.' } };
    expect(render().currentNoteHash).toBeNull();
    await vi.waitFor(() => expect(render().currentNoteHash).not.toBeNull());
    expect(render().currentNoteHash).not.toBe(previous);
  });

  it('does not confirm an old save after switching encounters', async () => {
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(Response.json(initial()));
    const saving = render().save(worksheet);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    props = { ...props, sessionId: 'session-2' };
    expect(render().state).toBeNull();
    pending.resolve(Response.json(await saved()));
    expect(await saving).toBeNull();
    await load();
    expect(render().state?.record).toBeNull();
  });
});
