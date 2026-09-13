import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MindManualNoteFieldsSchema, canonicalMindManualNote } from '@cureocity/contracts';
import {
  MindManualAutosave,
  readManualNoteSnapshot,
  type ManualAutosaveState,
  type ManualNoteSnapshot,
} from './mind-manual-autosave';

const fields = MindManualNoteFieldsSchema.parse({
  subjective: 'Fictional client account',
  objective: 'Discussed the agreed focus',
  assessment: 'Further information needed',
  plan: 'Review next visit',
  riskSeverity: 'none',
  riskDetails: 'Fictional clinician assessment and uncertainty',
});
const later = { ...fields, plan: 'A later agreed fictional plan' };
const initial = (): ManualNoteSnapshot => ({
  sessionId: 'fictional-session',
  kind: 'TREATMENT',
  purpose: 'COUNSELLING',
  status: 'IN_PROGRESS',
  revision: 0,
  noteUpdatedAt: null,
  fields: MindManualNoteFieldsSchema.parse({}),
  hasUnappliedDraft: false,
  note: null,
  signed: false,
  signedAt: null,
});
const packets = (fetcher: ReturnType<typeof vi.fn>) =>
  fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
function receipt(
  packet: ReturnType<typeof packets>[number],
  overrides: Partial<ManualNoteSnapshot> = {},
) {
  const complete = packet.operation === 'complete';
  const normalized = Object.fromEntries(
    Object.entries(packet.fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.trim() : value,
    ]),
  );
  return Response.json({
    ...initial(),
    fields: complete ? normalized : packet.fields,
    revision: packet.expectedRevision + 1,
    hasUnappliedDraft: !complete,
    status: complete ? 'COMPLETED' : 'IN_PROGRESS',
    note: complete ? canonicalMindManualNote('TREATMENT', null, packet.fields) : null,
    noteUpdatedAt: complete ? '2026-09-13T10:00:00.000Z' : packet.expectedNoteUpdatedAt,
    ...overrides,
  });
}
const accepting = () =>
  vi.fn(async (_url: unknown, init: RequestInit) => receipt(JSON.parse(String(init.body))));
const clients: MindManualAutosave[] = [];
function setup(request = accepting(), snapshot = initial(), delay = 1_000) {
  const states: ManualAutosaveState[] = [];
  const acknowledged = vi.fn();
  const client = new MindManualAutosave(
    snapshot,
    (state) => states.push(state),
    acknowledged,
    request as typeof fetch,
    delay,
  );
  clients.push(client);
  return { client, request, acknowledged, states, last: () => client.getState() };
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('manual note encrypted autosave controller', () => {
  it('does not send an untouched note or invoke any AI/audio endpoint', async () => {
    vi.useFakeTimers();
    const { client, request } = setup();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await client.flush()).toEqual(initial());
    expect(request).not.toHaveBeenCalled();
  });

  it('checkpoints continuous typing within one second instead of restarting the timer', async () => {
    vi.useFakeTimers();
    const { client, request, last } = setup();
    client.update(fields);
    await vi.advanceTimersByTimeAsync(400);
    client.update(later);
    await vi.advanceTimersByTimeAsync(400);
    client.update({ ...later, subjective: 'Most recent fictional words' });
    await vi.advanceTimersByTimeAsync(199);
    expect(request).not.toHaveBeenCalled();
    expect(last().protected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledOnce();
    expect(packets(request)[0].fields.subjective).toBe('Most recent fictional words');
    expect(last()).toMatchObject({ status: 'saved', protected: true });
  });

  it('serializes newer typing behind an in-flight snapshot and never calls it saved early', async () => {
    const resolvers: ((response: Response) => void)[] = [];
    const request = vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve)));
    const { client, last, states } = setup(request as never);
    client.update(fields);
    const work = client.flush();
    await Promise.resolve();
    client.update(later);
    expect(request).toHaveBeenCalledOnce();
    resolvers[0](receipt(packets(request)[0]));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(last().protected).toBe(false);
    expect(states.some((state) => state.status === 'saved')).toBe(false);
    expect(packets(request)[1]).toMatchObject({ fields: later, expectedRevision: 1 });
    resolvers[1](receipt(packets(request)[1]));
    expect(await work).not.toBeNull();
    expect(last()).toMatchObject({ status: 'saved', protected: true });
  });

  it.each(['network', '503', '408', '429', 'malformed', 'invalid'])(
    'retries the exact mutation after an ambiguous %s response, before newer edits',
    async (failure) => {
      const request = accepting();
      if (failure === 'network') request.mockRejectedValueOnce(new TypeError('Lost response'));
      else if (['503', '408', '429'].includes(failure))
        request.mockResolvedValueOnce(new Response('', { status: Number(failure) }));
      else if (failure === 'malformed') request.mockResolvedValueOnce(new Response('{'));
      else request.mockResolvedValueOnce(Response.json({ revision: 1 }));
      const { client, last } = setup(request);
      client.update(fields);
      expect(await client.flush()).toBeNull();
      expect(last()).toMatchObject({ status: 'error', protected: false, pendingOperation: 'save' });
      client.update(later);
      expect(last().status).toBe('error');
      await client.flush();
      expect(packets(request)[1]).toEqual(packets(request)[0]);
      expect(packets(request)[2]).toMatchObject({ expectedRevision: 1, fields: later });
      expect(packets(request)[2].mutationId).not.toBe(packets(request)[0].mutationId);
      expect(last().protected).toBe(true);
    },
  );

  it('does not cancel an uncertain write when the psychologist undoes back to the initial text', async () => {
    const request = accepting().mockRejectedValueOnce(new TypeError('Lost response'));
    const { client, last } = setup(request);
    client.update(fields);
    await client.flush();
    client.update(initial().fields);
    expect(last().protected).toBe(false);
    await client.flush();
    expect(packets(request)[2].fields).toEqual(initial().fields);
    expect(last().protected).toBe(true);
  });

  it.each([409, 401, 403, 404])(
    'stops after %s without adopting a newer revision or overwriting local text',
    async (status) => {
      vi.useFakeTimers();
      const request = accepting().mockResolvedValueOnce(
        Response.json({ error: 'Server refusal' }, { status }),
      );
      const { client, last, acknowledged } = setup(request);
      client.update(fields);
      await client.flush();
      expect(last()).toMatchObject({
        status: status === 409 ? 'conflict' : 'blocked',
        protected: false,
        pendingOperation: null,
      });
      expect(client.update(later)).toBe(false);
      expect(await client.flush()).toBeNull();
      expect(await client.complete()).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(request).toHaveBeenCalledOnce();
      expect(acknowledged).not.toHaveBeenCalled();
    },
  );

  it('does not treat a mismatched or stale server copy as acknowledgement', async () => {
    const request = vi.fn(async (_url: unknown, init: RequestInit) =>
      receipt(JSON.parse(String(init.body)), { fields: later, revision: 9 }),
    );
    const { client, last, acknowledged } = setup(request);
    client.update(fields);
    await client.flush();
    expect(last()).toMatchObject({ status: 'conflict', protected: false });
    expect(acknowledged).not.toHaveBeenCalled();
    expect(client.getSnapshot()).toEqual(initial());
  });

  it('finishes only after both in-flight and latest edits are acknowledged, once', async () => {
    let resolve!: (response: Response) => void;
    const request = accepting().mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { client, last } = setup(request);
    client.update(fields);
    const checkpoint = client.flush();
    await Promise.resolve();
    client.update(later);
    const finish = client.complete();
    expect(client.update({ ...fields, plan: 'Blocked during explicit finish' })).toBe(false);
    expect(await client.complete()).toBeNull();
    resolve(receipt(packets(request)[0]));
    await checkpoint;
    expect(await finish).toMatchObject({ status: 'COMPLETED', hasUnappliedDraft: false });
    expect(packets(request).map((packet) => packet.operation)).toEqual([
      'save',
      'save',
      'complete',
    ]);
    expect(packets(request)[2]).toMatchObject({ fields: later, expectedRevision: 2 });
    expect(last()).toMatchObject({ protected: true, finishing: false });
  });

  it('keeps an incomplete note saved without finishing or inventing a safety assessment', async () => {
    const { client, request, last } = setup();
    client.update({ ...initial().fields, subjective: 'An incomplete fictional note' });
    expect(await client.complete()).toBeNull();
    expect(packets(request).map((packet) => packet.operation)).toEqual(['save']);
    expect(last()).toMatchObject({ status: 'incomplete', protected: true });
    expect(client.update(fields)).toBe(true);
    expect(await client.complete()).toMatchObject({ status: 'COMPLETED' });
  });

  it('does not finish after a failed checkpoint and retains the receipt for retry', async () => {
    const request = accepting().mockRejectedValueOnce(new TypeError('Network lost'));
    const { client } = setup(request);
    client.update(fields);
    expect(await client.complete()).toBeNull();
    expect(packets(request).map((packet) => packet.operation)).toEqual(['save']);
    await client.complete();
    expect(packets(request)[1]).toEqual(packets(request)[0]);
    expect(packets(request)[2].operation).toBe('complete');
  });

  it('retries an uncertain completion without another completion or allowing hidden new edits', async () => {
    const request = accepting();
    request.mockImplementationOnce(async (_url, init) => receipt(JSON.parse(String(init.body))));
    request.mockRejectedValueOnce(new TypeError('Completion acknowledgement lost'));
    const { client, last } = setup(request);
    client.update(fields);
    expect(await client.complete()).toBeNull();
    expect(last()).toMatchObject({ pendingOperation: 'complete', protected: false });
    expect(client.update(later)).toBe(false);
    expect(await client.complete()).toMatchObject({ status: 'COMPLETED' });
    expect(request).toHaveBeenCalledTimes(3);
    expect(packets(request)[2]).toEqual(packets(request)[1]);
  });

  it('stops queued work and callbacks when the workspace is disposed', async () => {
    let resolve!: (response: Response) => void;
    const request = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const { client, acknowledged, states } = setup(request as never);
    client.update(fields);
    const work = client.flush();
    await Promise.resolve();
    client.update(later);
    client.dispose();
    const count = states.length;
    resolve(receipt(packets(request)[0]));
    expect(await work).toBeNull();
    expect(request).toHaveBeenCalledOnce();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(states).toHaveLength(count);
  });

  it('does not persist browser PHI and the UI waits for the controller before signing', async () => {
    const storage = {
      setItem: vi.fn(() => {
        throw new Error('No browser PHI');
      }),
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('indexedDB', { open: storage.setItem });
    const { client, request } = setup();
    client.update(fields);
    await client.complete();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(
      request.mock.calls.every(([url]) => url === '/api/v1/sessions/fictional-session/manual-note'),
    ).toBe(true);
    const source = readFileSync(
      new URL('../components/app/MindManualSession.tsx', import.meta.url),
      'utf8',
    );
    const sign = source.slice(
      source.indexOf('async function sign()'),
      source.indexOf('async function reopen()'),
    );
    expect(sign.indexOf('await controller.flush()')).toBeLessThan(
      sign.indexOf('await postSignNote('),
    );
    expect(sign).toContain('note: current.note');
    expect(source).toContain('useUnsavedWorkGuard(');
    expect(source).not.toContain('disabled={busy || !!pendingWrite.current}');
  });

  it('rejects incomplete or cross-session reads rather than replacing local fields with defaults', () => {
    expect(() =>
      readManualNoteSnapshot({ ...initial(), fields: {} }, 'fictional-session'),
    ).toThrow();
    expect(() => readManualNoteSnapshot(initial(), 'another-session')).toThrow();
    expect(readManualNoteSnapshot(initial(), 'fictional-session')).toEqual(initial());
  });
});
