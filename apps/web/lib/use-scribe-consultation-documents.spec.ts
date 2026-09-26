import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ScribeConsultationDocument,
  ScribeConsultationDocumentPacket,
  ScribeConsultationDocumentType,
  ScribeConsultationDocumentsResponse,
} from './scribe-consultation-documents';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  callbacks: [] as { deps: readonly unknown[]; callback: unknown }[],
  memos: [] as { deps: readonly unknown[]; value: unknown }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  callbackIndex: 0,
  memoIndex: 0,
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
  useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
    const index = h.memoIndex++;
    const previous = h.memos[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      h.memos[index] = { value: factory(), deps };
    return h.memos[index].value;
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
import { useScribeConsultationDocuments } from './use-scribe-consultation-documents';

const sourceHash = 'a'.repeat(64);
const timestamp = '2026-09-26T10:00:00.000Z';
const operationId = '76e2c960-52eb-4996-8c7e-de63872a3170';
function document(
  type: ScribeConsultationDocumentType = 'referral',
  reviewed = false,
): ScribeConsultationDocument {
  return {
    id: type,
    type,
    sourceSections: [{ label: 'Signed assessment', text: 'Fictional signed finding.' }],
    additions: '',
    status: reviewed ? 'reviewed' : 'draft',
    reviewedAt: reviewed ? timestamp : null,
    reviewedBy: reviewed ? 'doctor-1' : null,
  };
}
function packet(
  documents: ScribeConsultationDocument[] = [document()],
): ScribeConsultationDocumentPacket {
  return {
    id: 'packet-1',
    revision: 1,
    body: {
      version: 1,
      operationId,
      sourceHash,
      noteId: 'note-1',
      signedAt: timestamp,
      requestHash: 'b'.repeat(64),
      documents,
    },
    clientId: 'client-1',
    sessionId: 'session-1',
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceCurrent: true,
  };
}
function snapshot(
  packets: ScribeConsultationDocumentPacket[] = [],
): ScribeConsultationDocumentsResponse {
  return {
    source: { state: 'ready', hash: sourceHash, noteId: 'note-1', signedAt: timestamp },
    packets,
  };
}
function replyToCreate() {
  h.request.mockImplementationOnce((_url: string, init: RequestInit) => {
    const input = JSON.parse(init.body as string) as {
      operationId: string;
      expectedSourceHash: string;
      types: ScribeConsultationDocumentType[];
    };
    const created = packet(input.types.map((type) => document(type)));
    created.body.operationId = input.operationId;
    created.body.sourceHash = input.expectedSourceHash;
    return Promise.resolve(Response.json(snapshot([created])));
  });
}
function saved(
  original: ScribeConsultationDocumentPacket,
  additions: string,
  reviewed: boolean,
  documentId: ScribeConsultationDocumentType = 'referral',
): ScribeConsultationDocumentsResponse {
  const updated = structuredClone(original);
  updated.revision += 1;
  updated.body.documents = updated.body.documents.map((item) =>
    item.id === documentId
      ? {
          ...item,
          additions,
          status: reviewed ? 'reviewed' : 'draft',
          reviewedAt: reviewed ? timestamp : null,
          reviewedBy: reviewed ? 'doctor-1' : null,
        }
      : item,
  );
  return snapshot([updated]);
}

let props: Parameters<typeof useScribeConsultationDocuments>[0];
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = h.memoIndex = 0;
  const result = useScribeConsultationDocuments(props);
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
  h.memos = [];
  h.queued = [];
  vi.stubGlobal('crypto', webcrypto);
  props = { clientId: 'client-1', sessionId: 'session-1', enabled: true };
  h.request.mockImplementation(() => Promise.resolve(Response.json(snapshot())));
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('consultation document request isolation', () => {
  it('loads only when opened and uses an uncached, abortable encounter request', async () => {
    props.enabled = false;
    expect(render().state).toBeNull();
    expect(h.request).not.toHaveBeenCalled();
    props = { ...props, enabled: true };
    await load();
    expect(h.request).toHaveBeenCalledWith(
      '/api/v1/scribe/encounters/session-1/documents',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('immediately hides another patient/encounter and ignores its delayed read', async () => {
    const old = deferred<Response>();
    const next = packet();
    next.clientId = 'client-2';
    next.sessionId = 'session-2';
    next.id = 'packet-2';
    h.request
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(Response.json(snapshot([next])));
    render();
    const signal = h.request.mock.calls[0][1].signal as AbortSignal;
    props = { clientId: 'client-2', sessionId: 'session-2', enabled: true };
    expect(render().state).toBeNull();
    expect(signal.aborted).toBe(true);
    await load();
    old.resolve(Response.json(snapshot([packet()])));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(render().state?.packets[0].id).toBe('packet-2');
  });

  it('hides data on disable and aborts pending reads on unmount', async () => {
    await load();
    props = { ...props, enabled: false };
    expect(render().state).toBeNull();
    props = { ...props, enabled: true };
    h.request.mockReturnValueOnce(new Promise(() => {}));
    render();
    const signal = h.request.mock.calls.at(-1)![1].signal as AbortSignal;
    h.effects.forEach((effect) => effect.cleanup?.());
    expect(signal.aborted).toBe(true);
  });

  it.each(['malformed', 'client', 'session'])(
    'rejects a %s response without replacing previously validated state',
    async (kind) => {
      await load();
      const wrong = packet();
      if (kind === 'client') wrong.clientId = 'another-client';
      if (kind === 'session') wrong.sessionId = 'another-session';
      h.request.mockResolvedValueOnce(
        Response.json(kind === 'malformed' ? { packets: [] } : snapshot([wrong])),
      );
      await render().reload();
      expect(render().error).toBeTruthy();
      expect(render().state).toEqual(snapshot());
    },
  );
});

describe('creating source-bound document packets', () => {
  it('sends only selected types, source identity and operation ID, and waits for acknowledgement', async () => {
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const creating = render().create(['referral', 'patient_summary']);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(render().busy).toBe(true);
    expect(render().state?.packets).toEqual([]);
    const [url, init] = h.request.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/v1/scribe/encounters/session-1/documents');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
    const input = JSON.parse(init.body as string);
    expect(Object.keys(input).sort()).toEqual(['expectedSourceHash', 'operationId', 'types']);
    expect(input.expectedSourceHash).toBe(sourceHash);
    expect(input.types).toEqual(expect.arrayContaining(['referral', 'patient_summary']));
    expect(input.operationId).toMatch(/^[a-f0-9-]{36}$/);
    const created = packet([document('referral'), document('patient_summary')]);
    created.body.operationId = input.operationId;
    pending.resolve(Response.json(snapshot([created])));
    expect(await creating).toEqual(snapshot([created]));
    expect(render().busy).toBe(false);
  });

  it('reuses the operation after an ambiguous failure with the same source/type set', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Connection lost after request was sent.'));
    expect(await render().create(['referral', 'patient_summary'])).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(render().state?.packets).toEqual([]);
    const first = JSON.parse(h.request.mock.calls[1][1].body);
    replyToCreate();
    expect(await render().create(['patient_summary', 'referral'])).not.toBeNull();
    const second = JSON.parse(h.request.mock.calls[2][1].body);
    expect(second.operationId).toBe(first.operationId);
    expect(new Set(second.types)).toEqual(new Set(first.types));
  });

  it('does not reuse an operation for different selected types', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Disconnected'));
    await render().create(['referral']);
    const first = JSON.parse(h.request.mock.calls[1][1].body);
    replyToCreate();
    await render().create(['patient_summary']);
    expect(JSON.parse(h.request.mock.calls[2][1].body).operationId).not.toBe(first.operationId);
  });

  it('accepts an idempotent create replay without resetting an already reviewed document', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Response lost after persistence.'));
    await render().create(['referral']);
    const input = JSON.parse(h.request.mock.calls[1][1].body);
    const replay = packet([
      { ...document('referral', true), additions: 'Existing reviewed additions.' },
    ]);
    replay.revision = 2;
    replay.body.operationId = input.operationId;
    h.request.mockResolvedValueOnce(Response.json(snapshot([replay])));
    expect(await render().create(['referral'])).toEqual(snapshot([replay]));
    expect(render().state?.packets[0].body.documents[0]).toMatchObject({
      status: 'reviewed',
      additions: 'Existing reviewed additions.',
    });
  });

  it('does not reuse an operation after the signed source changes', async () => {
    await load();
    h.request.mockRejectedValueOnce(new Error('Disconnected'));
    await render().create(['referral']);
    const first = JSON.parse(h.request.mock.calls[1][1].body);
    const newer = snapshot();
    newer.source.hash = 'c'.repeat(64);
    h.request.mockResolvedValueOnce(Response.json(newer));
    await render().reload();
    h.request.mockRejectedValueOnce(new Error('Disconnected again'));
    await render().create(['referral']);
    const second = JSON.parse(h.request.mock.calls[3][1].body);
    expect(second.operationId).not.toBe(first.operationId);
    expect(second.expectedSourceHash).toBe(newer.source.hash);
  });

  it('serializes mutations and prevents reload from cancelling an unconfirmed write', async () => {
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const creating = render().create(['referral']);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(await render().create(['patient_summary'])).toBeNull();
    await render().reload();
    expect(h.request).toHaveBeenCalledTimes(2);
    pending.resolve(Response.json({ error: 'Unable to confirm persistence.' }, { status: 503 }));
    expect(await creating).toBeNull();
    expect(render().busy).toBe(false);
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it.each(['unsigned', 'unavailable'] as const)(
    'does not create from a %s source',
    async (state) => {
      h.request.mockResolvedValueOnce(
        Response.json({ source: { state, hash: null, noteId: null, signedAt: null }, packets: [] }),
      );
      await load();
      expect(await render().create(['referral'])).toBeNull();
      expect(h.request).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a create acknowledgement missing the requested operation and selected documents', async () => {
    await load();
    h.request.mockResolvedValueOnce(Response.json(snapshot([packet()])));
    expect(await render().create(['patient_summary'])).toBeNull();
    expect(render().error).toBeTruthy();
    expect(render().state?.packets).toEqual([]);
  });

  it('bounds read and write request lifetimes', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await load();
    replyToCreate();
    expect(await render().create(['referral'])).not.toBeNull();
    expect(timeout.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [milliseconds] of timeout.mock.calls) {
      expect(milliseconds).toBeGreaterThan(0);
      expect(milliseconds).toBeLessThanOrEqual(15_000);
    }
  });
});

describe('document save acknowledgements', () => {
  const additions = 'Doctor-added referral reason, explicitly reviewed.';
  it('saves only additions/review state against the exact packet revision', async () => {
    const original = packet([document(), document('patient_summary')]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const acknowledgement = saved(original, additions, true);
    h.request.mockResolvedValueOnce(Response.json(acknowledgement));
    expect(
      await render().save(original.id, original.revision, 'referral', additions, true),
    ).toEqual(acknowledgement);
    expect(h.request.mock.calls[1][0]).toBe('/api/v1/scribe/documents/packet-1');
    const init = h.request.mock.calls[1][1];
    expect(init).toMatchObject({ method: 'PATCH', cache: 'no-store' });
    expect(JSON.parse(init.body)).toEqual({
      revision: 1,
      documentId: 'referral',
      additions,
      reviewed: true,
    });
  });

  it.each(['revision', 'text', 'review', 'target-source', 'sibling-source', 'packet-source'])(
    'does not confirm a save with changed %s data',
    async (change) => {
      const original = packet([document(), document('patient_summary')]);
      h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
      await load();
      const wrong = saved(original, additions, true);
      const row = wrong.packets[0];
      if (change === 'revision') row.revision = original.revision;
      if (change === 'text') row.body.documents[0].additions = 'Different text';
      if (change === 'review') row.body.documents[0] = { ...document(), additions };
      if (change === 'target-source')
        row.body.documents[0].sourceSections[0].text = 'Altered source';
      if (change === 'sibling-source')
        row.body.documents[1].sourceSections[0].text = 'Altered source';
      if (change === 'packet-source') row.body.sourceHash = 'c'.repeat(64);
      h.request.mockResolvedValueOnce(Response.json(wrong));
      expect(
        await render().save(original.id, original.revision, 'referral', additions, true),
      ).toBeNull();
      expect(render().error).toBeTruthy();
      expect(render().state?.packets[0]).toEqual(original);
    },
  );

  it('preserves the previous packet after conflict without automatic retry', async () => {
    const original = packet();
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'Packet changed; reload.' }, { status: 409 }),
    );
    expect(
      await render().save(original.id, original.revision, 'referral', additions, false),
    ).toBeNull();
    expect(render().state?.packets[0]).toEqual(original);
    expect(render().error).toContain('reload');
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('refuses stale packets and stale local revisions before sending an update', async () => {
    const original = packet();
    original.sourceCurrent = false;
    original.body.sourceHash = 'c'.repeat(64);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    expect(await render().save(original.id, 1, 'referral', additions, false)).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(1);
    original.sourceCurrent = true;
    original.body.sourceHash = sourceHash;
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await render().reload();
    expect(await render().save(original.id, 2, 'referral', additions, false)).toBeNull();
    expect(h.request).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight save on encounter change and ignores its acknowledgement', async () => {
    const original = packet();
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const saving = render().save(original.id, 1, 'referral', additions, true);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    props = { clientId: 'client-2', sessionId: 'session-2', enabled: true };
    expect(render().state).toBeNull();
    expect(signal.aborted).toBe(true);
    pending.resolve(Response.json(saved(original, additions, true)));
    expect(await saving).toBeNull();
    await load();
    expect(render().state?.packets).toEqual([]);
  });
});

describe('reviewed draft attachment downloads', () => {
  function attachment() {
    return new Response('DRAFT — not issued\nFictional signed finding.', {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="referral-DRAFT.txt"',
      },
    });
  }
  function browserDownload() {
    const anchor = { href: '', download: '', click: vi.fn() };
    const createElement = vi.fn(() => anchor);
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-only');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal('document', { createElement });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    return { anchor, createElement, createUrl, revokeUrl, localStorage, sessionStorage };
  }

  it('downloads only the saved reviewed revision as an attachment and immediately revokes its URL', async () => {
    const original = packet([document('referral', true)]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const browser = browserDownload();
    h.request.mockResolvedValueOnce(attachment());
    expect(await render().download(original, original.body.documents[0])).toBe(true);
    expect(h.request.mock.calls[1][0]).toBe(
      '/api/v1/scribe/documents/packet-1/referral/text?revision=1',
    );
    expect(h.request.mock.calls[1][1]).toMatchObject({
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(browser.createUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(browser.createElement).toHaveBeenCalledWith('a');
    expect(browser.anchor.download).toContain('DRAFT');
    expect(browser.anchor.click).toHaveBeenCalledTimes(1);
    expect(browser.revokeUrl).toHaveBeenCalledWith('blob:test-only');
    for (const storage of [browser.localStorage, browser.sessionStorage]) {
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    }
    expect(render().busy).toBe(false);
  });

  it.each(['draft', 'stale-source', 'stale-revision', 'unknown-packet', 'unknown-document'])(
    'does not download a %s document',
    async (reason) => {
      const original = packet([document('referral', reason !== 'draft')]);
      if (reason === 'stale-source') {
        original.sourceCurrent = false;
        original.body.sourceHash = 'c'.repeat(64);
      }
      h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
      await load();
      const selected = structuredClone(original);
      if (reason === 'stale-revision') selected.revision += 1;
      if (reason === 'unknown-packet') selected.id = 'not-loaded';
      const selectedDocument =
        reason === 'unknown-document'
          ? document('patient_summary', true)
          : {
              ...selected.body.documents[0],
              status: 'reviewed' as const,
              reviewedAt: timestamp,
              reviewedBy: 'doctor-1',
            };
      expect(await render().download(selected, selectedDocument)).toBe(false);
      expect(h.request).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['wrong-type', 'inline', 'missing-disposition'])(
    'rejects a %s response without creating a downloadable URL',
    async (kind) => {
      const original = packet([document('referral', true)]);
      h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
      await load();
      const browser = browserDownload();
      const headers = new Headers({
        'content-type': 'text/plain',
        'content-disposition': 'attachment;',
      });
      if (kind === 'wrong-type') headers.set('content-type', 'text/html');
      if (kind === 'inline') headers.set('content-disposition', 'inline; filename="document.txt"');
      if (kind === 'missing-disposition') headers.delete('content-disposition');
      h.request.mockResolvedValueOnce(new Response('Not a verified attachment', { headers }));
      expect(await render().download(original, original.body.documents[0])).toBe(false);
      expect(render().error).toBeTruthy();
      expect(browser.createUrl).not.toHaveBeenCalled();
      expect(browser.anchor.click).not.toHaveBeenCalled();
    },
  );

  it('does not retry a denied download or mutate the stored review status', async () => {
    const original = packet([document('referral', true)]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const browser = browserDownload();
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'The signed source changed.' }, { status: 409 }),
    );
    expect(await render().download(original, original.body.documents[0])).toBe(false);
    expect(render().state?.packets[0]).toEqual(original);
    expect(render().error).toContain('signed source changed');
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(browser.anchor.click).not.toHaveBeenCalled();
  });

  it('aborts a download on scope change and never clicks a delayed attachment', async () => {
    const original = packet([document('referral', true)]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const browser = browserDownload();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const downloading = render().download(original, original.body.documents[0]);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    const signal = h.request.mock.calls[1][1].signal as AbortSignal;
    expect(render().busy).toBe(true);
    props = { clientId: 'client-2', sessionId: 'session-2', enabled: true };
    expect(render().state).toBeNull();
    expect(signal.aborted).toBe(true);
    pending.resolve(attachment());
    expect(await downloading).toBe(false);
    expect(browser.anchor.click).not.toHaveBeenCalled();
    expect(browser.createUrl).not.toHaveBeenCalled();
  });

  it('does not start a second action while a download is unconfirmed', async () => {
    const original = packet([document('referral', true)]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    const downloading = render().download(original, original.body.documents[0]);
    await vi.waitFor(() => expect(h.request).toHaveBeenCalledTimes(2));
    expect(await render().create(['referral'])).toBeNull();
    expect(await render().save(original.id, 1, 'referral', 'New text', false)).toBeNull();
    expect(await render().download(original, original.body.documents[0])).toBe(false);
    await render().reload();
    expect(h.request).toHaveBeenCalledTimes(2);
    pending.resolve(Response.json({ error: 'Download failed.' }, { status: 503 }));
    expect(await downloading).toBe(false);
  });

  it('also suppresses an attachment when scope changes while its response body is being read', async () => {
    const original = packet([document('referral', true)]);
    h.request.mockResolvedValueOnce(Response.json(snapshot([original])));
    await load();
    const browser = browserDownload();
    const body = deferred<Blob>();
    const response = attachment();
    const readBody = vi.spyOn(response, 'blob').mockReturnValue(body.promise);
    h.request.mockResolvedValueOnce(response);
    const downloading = render().download(original, original.body.documents[0]);
    await vi.waitFor(() => expect(readBody).toHaveBeenCalledTimes(1));
    props = { ...props, enabled: false };
    expect(render().state).toBeNull();
    body.resolve(new Blob(['DRAFT — previous patient text'], { type: 'text/plain' }));
    expect(await downloading).toBe(false);
    expect(browser.createUrl).not.toHaveBeenCalled();
    expect(browser.anchor.click).not.toHaveBeenCalled();
  });
});
