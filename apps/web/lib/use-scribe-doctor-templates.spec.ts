import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from './sign-note-payload';
import { DEFAULT_SCRIBE_NOTE_STYLE } from './scribe-personalization-contracts';
import type { ScribeDoctorTemplate, ScribeDoctorTemplateRecord } from './scribe-doctor-templates';

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
import { scribeDoctorTemplateHash, useScribeDoctorTemplates } from './use-scribe-doctor-templates';

const timestamp = '2026-09-26T10:00:00.000Z';
const operationId = '76e2c960-52eb-4996-8c7e-de63872a3170';
const template: ScribeDoctorTemplate = {
  kind: 'document_skeleton',
  name: 'Referral prompts',
  documentType: 'referral',
  prompts: ['recipient', 'clinical_question'],
};
function hash(value: ScribeDoctorTemplate) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
function record(value: ScribeDoctorTemplate = template): ScribeDoctorTemplateRecord {
  return {
    id: 'template-1',
    revision: 1,
    clientId: null,
    sessionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    body: { version: 1, operationId, createHash: hash(value), template: structuredClone(value) },
  };
}
function replyToCreate(change?: (result: ScribeDoctorTemplateRecord) => void) {
  h.request.mockImplementationOnce((_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string) as {
      operationId: string;
      template: ScribeDoctorTemplate;
    };
    const result = record(input.template);
    result.body.operationId = input.operationId;
    change?.(result);
    return Promise.resolve(Response.json({ record: result }));
  });
}
function updated(
  original: ScribeDoctorTemplateRecord,
  value: ScribeDoctorTemplate,
): ScribeDoctorTemplateRecord {
  return {
    ...structuredClone(original),
    revision: original.revision + 1,
    body: { ...original.body, template: structuredClone(value) },
  };
}
let enabled: boolean;
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = 0;
  const result = useScribeDoctorTemplates(enabled);
  h.queued.splice(0).forEach((run) => run());
  return result;
}
async function load(records: ScribeDoctorTemplateRecord[] = []) {
  h.request.mockResolvedValueOnce(Response.json({ records }));
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

beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.callbacks = [];
  h.queued = [];
  h.transport = h.request;
  h.request.mockImplementation(() => Promise.resolve(Response.json({ records: [] })));
  enabled = true;
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('private template request lifecycle', () => {
  it('loads only when enabled, without browser caching or patient scope', async () => {
    enabled = false;
    expect(render()).toMatchObject({ records: [], loaded: false, loading: false });
    expect(h.request).not.toHaveBeenCalled();
    enabled = true;
    await load();
    expect(h.request).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/scribe/templates',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('hides and clears private preferences when disabled, then reloads on reopening', async () => {
    await load([record()]);
    enabled = false;
    expect(render()).toMatchObject({ records: [], loaded: false, busy: false, error: null });
    enabled = true;
    expect(render().records).toEqual([]);
    await vi.waitFor(() => expect(render().loaded).toBe(true));
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(render().records).toEqual([]);
  });

  it('aborts and ignores a delayed read after disabling', async () => {
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    render();
    const signal = h.request.mock.calls[0][1].signal as AbortSignal;
    enabled = false;
    render();
    expect(signal.aborted).toBe(true);
    delayed.resolve(Response.json({ records: [record()] }));
    await delayed.promise;
    await Promise.resolve();
    expect(render().records).toEqual([]);
  });

  it('immediately hides old transport data and ignores a late old-context acknowledgement', async () => {
    await load([record()]);
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const save = render().save({ ...template, name: 'Changed' }, record());
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    const other = vi.fn().mockResolvedValue(Response.json({ records: [] }));
    h.transport = other;
    expect(render()).toMatchObject({ records: [], loaded: false });
    expect(signal.aborted).toBe(true);
    delayed.resolve(Response.json({ record: updated(record(), { ...template, name: 'Changed' }) }));
    expect(await save).toBeNull();
    await vi.waitFor(() => expect(render().loaded).toBe(true));
    expect(render().records).toEqual([]);
    expect(other).toHaveBeenCalledOnce();
  });

  it('aborts the active request on unmount', () => {
    h.request.mockReturnValueOnce(deferred<Response>().promise);
    render();
    const signal = h.request.mock.calls[0][1].signal as AbortSignal;
    h.effects.forEach((effect) => effect.cleanup?.());
    expect(signal.aborted).toBe(true);
  });

  it('does not let retained callbacks write or reload a disabled context', async () => {
    const previous = await load([record()]);
    enabled = false;
    render();
    expect(await previous.save(template)).toBeNull();
    expect(await previous.remove(record())).toBe(false);
    await previous.reload();
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('does not mutate before the initial load is confirmed', async () => {
    h.request.mockReturnValueOnce(deferred<Response>().promise);
    const state = render();
    expect(await state.save(template)).toBeNull();
    expect(await state.remove(record())).toBe(false);
    expect(h.request).toHaveBeenCalledOnce();
  });

  it.each([
    ['malformed', { records: [{ id: 'bad' }] }],
    ['patient-scoped', { records: [{ ...record(), clientId: 'patient-1' }] }],
    ['encounter-scoped', { records: [{ ...record(), sessionId: 'session-1' }] }],
    ['duplicate IDs', { records: [record(), record()] }],
  ])('rejects %s lists and retains the last verified records', async (_name, value) => {
    await load([record()]);
    h.request.mockResolvedValueOnce(Response.json(value));
    await render().reload();
    expect(render().records).toEqual([record()]);
    expect(render().error).toBeTruthy();
    expect(render().loaded).toBe(true);
  });

  it('retains the verified list on network failure with no automatic retry', async () => {
    await load([record()]);
    h.request.mockRejectedValueOnce(new Error('Offline'));
    await render().reload();
    expect(render()).toMatchObject({ records: [record()], error: 'Offline', loading: false });
    render();
    render();
    expect(h.request).toHaveBeenCalledTimes(2);
  });
});

describe('private template save acknowledgements', () => {
  it('uses the exact canonical server hash, including presentation configuration', async () => {
    const style: ScribeDoctorTemplate = {
      kind: 'note_presentation',
      name: 'OPD',
      style: DEFAULT_SCRIBE_NOTE_STYLE,
    };
    expect(await scribeDoctorTemplateHash(style)).toBe(hash(style));
    expect(await scribeDoctorTemplateHash({ ...template, name: '  Referral prompts  ' })).toBe(
      hash(template),
    );
    expect(
      await scribeDoctorTemplateHash({ ...template, prompts: ['clinical_question', 'recipient'] }),
    ).not.toBe(hash(template));
  });

  it('creates only an explicitly acknowledged private template and updates from the exact acknowledgement', async () => {
    await load();
    replyToCreate();
    const result = await render().save(template);
    expect(result?.body.template).toEqual(template);
    const [url, init] = h.request.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/scribe/templates');
    expect(init).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(init.body as string)).toEqual({
      operationId: expect.any(String),
      template,
      containsNoPatientData: true,
    });
    expect(result).toMatchObject({ clientId: null, sessionId: null });
    expect(render().records).toEqual([result]);
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('reuses create identity after uncertain failure for the same canonical template', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Connection lost'));
    expect(await render().save(template)).toBeNull();
    const first = JSON.parse(h.request.mock.calls[1][1].body as string);
    replyToCreate();
    await render().save({ ...template, name: '  Referral prompts  ' });
    const second = JSON.parse(h.request.mock.calls[2][1].body as string);
    expect(second.operationId).toBe(first.operationId);
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it('starts a fresh same-body create intent after a successful explicit library reload', async () => {
    await load();
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'This creation operation was deleted.' }, { status: 409 }),
    );
    expect(await render().save(template)).toBeNull();
    const first = JSON.parse(h.request.mock.calls[1][1].body as string);
    await render().reload();
    replyToCreate();
    expect(await render().save(template)).not.toBeNull();
    const second = JSON.parse(h.request.mock.calls[3][1].body as string);
    expect(second.operationId).not.toBe(first.operationId);
    expect(h.request).toHaveBeenCalledTimes(4);
  });

  it('retains the original same-body retry identity after a failed explicit reload', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Connection lost'));
    expect(await render().save(template)).toBeNull();
    const first = JSON.parse(h.request.mock.calls[1][1].body as string);
    h.request.mockRejectedValueOnce(new Error('Still offline'));
    await render().reload();
    replyToCreate();
    expect(await render().save(template)).not.toBeNull();
    const second = JSON.parse(h.request.mock.calls[3][1].body as string);
    expect(second.operationId).toBe(first.operationId);
    expect(h.request).toHaveBeenCalledTimes(4);
  });

  it('does not clear a newer create retry identity when an aborted older reload returns late', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Connection lost'));
    await render().save(template);
    const first = JSON.parse(h.request.mock.calls[1][1].body as string);
    const oldResponse = deferred<Response>();
    h.request.mockReturnValueOnce(oldResponse.promise);
    const oldReload = render().reload();
    const oldSignal = h.request.mock.calls[2][1].signal as AbortSignal;
    await render().reload();
    expect(oldSignal.aborted).toBe(true);
    const newResponse = deferred<Response>();
    h.request.mockReturnValueOnce(newResponse.promise);
    const newSave = render().save(template);
    const second = JSON.parse(h.request.mock.calls[4][1].body as string);
    expect(second.operationId).not.toBe(first.operationId);
    oldResponse.resolve(Response.json({ records: [] }));
    await oldReload;
    expect(render().busy).toBe(true);
    newResponse.resolve(Response.json({ error: 'Connection lost' }, { status: 503 }));
    expect(await newSave).toBeNull();
    replyToCreate();
    await render().save(template);
    const retry = JSON.parse(h.request.mock.calls[5][1].body as string);
    expect(retry.operationId).toBe(second.operationId);
    expect(h.request).toHaveBeenCalledTimes(6);
  });

  it('uses a new operation for a changed template and after a successful create', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Offline'));
    await render().save(template);
    const first = JSON.parse(h.request.mock.calls[1][1].body as string).operationId;
    const changed = { ...template, name: 'Another referral' };
    replyToCreate();
    await render().save(changed);
    const second = JSON.parse(h.request.mock.calls[2][1].body as string).operationId;
    replyToCreate((result) => {
      result.id = 'template-2';
    });
    await render().save(changed);
    const third = JSON.parse(h.request.mock.calls[3][1].body as string).operationId;
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('preserves later edits returned by an idempotent create replay with the original hash', async () => {
    await load();
    replyToCreate((result) => {
      result.revision = 3;
      result.body.template = { ...template, name: 'Edited on another screen' };
    });
    const result = await render().save(template);
    expect(result?.revision).toBe(3);
    expect(render().records[0].body.template.name).toBe('Edited on another screen');
  });

  it.each([
    [
      'operation',
      (result: ScribeDoctorTemplateRecord) => {
        result.body.operationId = operationId;
      },
    ],
    [
      'original hash',
      (result: ScribeDoctorTemplateRecord) => {
        result.body.createHash = 'a'.repeat(64);
      },
    ],
    [
      'revision-one template',
      (result: ScribeDoctorTemplateRecord) => {
        result.body.template = { ...template, name: 'Different' };
      },
    ],
    [
      'personal scope',
      (result: ScribeDoctorTemplateRecord) => {
        Object.assign(result, { clientId: 'patient-1' });
      },
    ],
  ])('rejects a create acknowledgement with mismatched %s', async (_name, change) => {
    await load();
    replyToCreate(change);
    expect(await render().save(template)).toBeNull();
    expect(render().records).toEqual([]);
    expect(render().error).toBeTruthy();
  });

  it('rejects a create replay that would replace a newer known revision', async () => {
    const known = record();
    known.revision = 4;
    await load([known]);
    replyToCreate((result) => {
      result.revision = 2;
    });
    expect(await render().save(template)).toBeNull();
    expect(render().records).toEqual([known]);
  });

  it('updates by revision and preserves the immutable original create identity', async () => {
    const original = record();
    await load([original]);
    const changed = { ...template, name: 'Changed referral' };
    const ack = updated(original, changed);
    h.request.mockResolvedValueOnce(Response.json({ record: ack }));
    expect(await render().save(changed, original)).toEqual(ack);
    expect(h.request.mock.calls[1][0]).toBe('/api/v1/scribe/templates/template-1');
    expect(JSON.parse(h.request.mock.calls[1][1].body as string)).toEqual({
      revision: 1,
      template: changed,
      containsNoPatientData: true,
    });
    expect(render().records).toEqual([ack]);
  });

  it.each([
    [
      'id',
      (value: ScribeDoctorTemplateRecord) => {
        value.id = 'other';
      },
    ],
    [
      'revision',
      (value: ScribeDoctorTemplateRecord) => {
        value.revision = 3;
      },
    ],
    [
      'template',
      (value: ScribeDoctorTemplateRecord) => {
        value.body.template = template;
      },
    ],
    [
      'operation',
      (value: ScribeDoctorTemplateRecord) => {
        value.body.operationId = 'b3e540f9-74a7-443c-b284-e78b6f062983';
      },
    ],
    [
      'create hash',
      (value: ScribeDoctorTemplateRecord) => {
        value.body.createHash = 'c'.repeat(64);
      },
    ],
    [
      'creation time',
      (value: ScribeDoctorTemplateRecord) => {
        value.createdAt = '2026-09-25T10:00:00.000Z';
      },
    ],
  ])('rejects an update acknowledgement with mismatched %s', async (_name, change) => {
    const original = record();
    await load([original]);
    const changed = { ...template, name: 'Changed' };
    const ack = updated(original, changed);
    change(ack);
    h.request.mockResolvedValueOnce(Response.json({ record: ack }));
    expect(await render().save(changed, original)).toBeNull();
    expect(render().records).toEqual([original]);
    expect(render().error).toBeTruthy();
  });

  it('blocks stale revision and invalid free-text clinical fields before writing', async () => {
    await load([record()]);
    expect(await render().save(template, { ...record(), revision: 2 })).toBeNull();
    const unsafe = { ...template, text: 'Unreviewed clinical assertion' } as ScribeDoctorTemplate;
    expect(await render().save(unsafe)).toBeNull();
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('serializes writes and blocks reload during a pending write', async () => {
    await load([record()]);
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const first = render().save({ ...template, name: 'Changed' }, record());
    expect(render().busy).toBe(true);
    expect(await render().save(template)).toBeNull();
    expect(await render().remove(record())).toBe(false);
    await render().reload();
    expect(h.request).toHaveBeenCalledTimes(2);
    delayed.resolve(Response.json({ record: updated(record(), { ...template, name: 'Changed' }) }));
    expect(await first).not.toBeNull();
    expect(render().busy).toBe(false);
  });

  it('checks cancellation again after asynchronous acknowledgement hashing', async () => {
    await load();
    const digest = deferred<ArrayBuffer>();
    vi.spyOn(crypto.subtle, 'digest').mockReturnValueOnce(digest.promise);
    replyToCreate();
    const save = render().save(template);
    await vi.waitFor(() => expect(crypto.subtle.digest).toHaveBeenCalled());
    enabled = false;
    render();
    digest.resolve(new Uint8Array(Buffer.from(hash(template), 'hex')).buffer);
    expect(await save).toBeNull();
    expect(render().records).toEqual([]);
  });
});

describe('private template deletion and request boundaries', () => {
  it('removes only after an exact id and revision acknowledgement', async () => {
    await load([record()]);
    h.request.mockResolvedValueOnce(Response.json({ deletedId: 'template-1', revision: 1 }));
    expect(await render().remove(record())).toBe(true);
    expect(h.request.mock.calls[1][1]).toMatchObject({ method: 'DELETE', cache: 'no-store' });
    expect(JSON.parse(h.request.mock.calls[1][1].body as string)).toEqual({ revision: 1 });
    expect(render().records).toEqual([]);
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { deletedId: 'other', revision: 1 },
    { deletedId: 'template-1', revision: 2 },
    { ok: true },
  ])('retains saved records for a mismatched deletion acknowledgement %#', async (ack) => {
    await load([record()]);
    h.request.mockResolvedValueOnce(Response.json(ack));
    expect(await render().remove(record())).toBe(false);
    expect(render().records).toEqual([record()]);
    expect(render().error).toBeTruthy();
  });

  it('does not delete a stale or absent record', async () => {
    await load([record()]);
    expect(await render().remove({ ...record(), revision: 2 })).toBe(false);
    expect(await render().remove({ ...record(), id: 'absent' })).toBe(false);
    expect(h.request).toHaveBeenCalledOnce();
  });

  it('retains saved records for failed or empty delete acknowledgements without retry', async () => {
    await load([record()]);
    h.request.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await render().remove(record())).toBe(false);
    expect(render().records).toEqual([record()]);
    render();
    render();
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('bounds requests and does not persist preferences to browser storage or broadcast events', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const localStorage = { setItem: vi.fn() },
      sessionStorage = { setItem: vi.fn() };
    const dispatchEvent = vi.fn();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('window', { dispatchEvent });
    await load();
    replyToCreate();
    await render().save(template);
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([12_000, 15_000]);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('rejects a response that arrives after its timeout and clears busy without a retry', async () => {
    await load([record()]);
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal);
    const delayed = deferred<Response>();
    h.request.mockReturnValueOnce(delayed.promise);
    const save = render().save({ ...template, name: 'Changed' }, record());
    deadline.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
    delayed.resolve(Response.json({ record: updated(record(), { ...template, name: 'Changed' }) }));
    expect(await save).toBeNull();
    expect(render()).toMatchObject({ records: [record()], busy: false });
    expect(render().error).toContain('not confirmed');
    expect(h.request).toHaveBeenCalledTimes(2);
  });
});
