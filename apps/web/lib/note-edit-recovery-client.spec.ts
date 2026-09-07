import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NoteEditRecoveryClient,
  type RecoveryClientState,
  type RecoveryRead,
} from './note-edit-recovery-client';

const target = {
  sessionId: 'fictional-session',
  baseUpdatedAt: '2026-09-07T10:00:00.000Z',
  kind: 'TREATMENT' as const,
};
const initial = {
  subjective: 'Fictional account',
  objective: 'Fictional observations',
  assessment: 'Fictional assessment',
  plan: 'Fictional plan',
};
const changed = { ...initial, subjective: 'Revised fictional account' };
const later = { ...changed, plan: 'Later fictional plan' };
const stamp = '2026-09-07T10:01:00.000Z';
const empty = (): RecoveryRead => ({ revision: 0, recovery: null, stale: false });
function setup(fetcher: typeof fetch, delay = 5) {
  const states: RecoveryClientState[] = [];
  const restore = vi.fn();
  const client = new NoteEditRecoveryClient(
    target,
    initial,
    (state) => states.push(state),
    restore,
    fetcher,
    delay,
  );
  clients.push(client);
  return { client, restore, states, last: () => states.at(-1)! };
}
let clients: NoteEditRecoveryClient[] = [];
afterEach(() => {
  for (const client of clients) client.dispose();
  clients = [];
  vi.useRealTimers();
});

describe('encrypted server recovery client', () => {
  it('keeps undo guarded while an earlier mutation may still replace the server copy', async () => {
    let finish!: (response: Response) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    const { client, last } = setup(request);
    await client.load();
    client.update(changed);
    const work = client.flush();
    client.update(initial);
    expect(last()).toMatchObject({ status: 'saving', protected: false });
    client.dispose();
    finish(Response.json({ revision: 1, updatedAt: stamp }));
    await work;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps an undone value guarded after a lost response until the compensation is acknowledged', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockRejectedValueOnce(new TypeError('Lost response'))
      .mockResolvedValueOnce(Response.json({ revision: 1, updatedAt: stamp }))
      .mockResolvedValueOnce(Response.json({ revision: 2, updatedAt: stamp }));
    const { client, last } = setup(request);
    await client.load();
    client.update(changed);
    await client.flush();
    client.update(initial);
    expect(last().protected).toBe(false);
    await client.retry();
    expect(last().protected).toBe(true);
    expect(JSON.parse(request.mock.calls[3]![1].body).fields).toEqual(initial);
  });

  it('adopts a current server checkpoint only through an explicit replacement choice', async () => {
    const remote = {
      fields: later,
      kind: target.kind,
      baseUpdatedAt: target.baseUpdatedAt,
      updatedAt: stamp,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockResolvedValueOnce(Response.json({}, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ revision: 9, recovery: remote, stale: false }))
      .mockResolvedValueOnce(Response.json({ revision: 10, updatedAt: stamp }));
    const { client, restore, last } = setup(request);
    await client.load();
    client.update(changed);
    await client.flush();
    expect(await client.useServerCopy()).toBe(true);
    expect(restore).toHaveBeenCalledWith(later);
    expect(last().protected).toBe(true);
    client.update({ ...later, subjective: 'Explicit subsequent change' });
    await client.flush();
    expect(JSON.parse(request.mock.calls[3]![1].body).revision).toBe(9);
  });

  it('does not adopt a server copy whose canonical version has since changed', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockResolvedValueOnce(Response.json({}, { status: 409 }))
      .mockResolvedValueOnce(
        Response.json({
          revision: 3,
          stale: true,
          recovery: {
            fields: later,
            kind: target.kind,
            baseUpdatedAt: target.baseUpdatedAt,
            updatedAt: stamp,
          },
        }),
      );
    const { client, restore, last } = setup(request);
    await client.load();
    client.update(changed);
    await client.flush();
    expect(await client.useServerCopy()).toBe(false);
    expect(restore).not.toHaveBeenCalled();
    expect(last().protected).toBe(false);
  });
  it('does not autosave an untouched note and waits for hydration', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(empty()));
    const { client, last } = setup(request);
    expect(await client.flush()).toBe(false);
    await client.load();
    expect(await client.flush()).toBe(true);
    expect(last()).toMatchObject({ status: 'ready', protected: true });
    expect(request).toHaveBeenCalledOnce();
  });

  it('restores acknowledged incomplete clinical fields without requiring canonical validation', async () => {
    const fields = { ...initial, assessment: '' };
    const request = vi.fn().mockResolvedValue(
      Response.json({
        revision: 3,
        stale: false,
        recovery: {
          fields,
          kind: target.kind,
          baseUpdatedAt: target.baseUpdatedAt,
          updatedAt: stamp,
        },
      }),
    );
    const { client, last, restore } = setup(request);
    await client.load();
    expect(restore).toHaveBeenCalledWith(fields);
    expect(last()).toMatchObject({ status: 'saved', restored: true, protected: true });
    expect(client.getRevision()).toBe(3);
  });

  it('never restores a stale copy onto a newer canonical note', async () => {
    const recovery = {
      fields: changed,
      kind: target.kind,
      baseUpdatedAt: '2026-09-06T10:00:00.000Z',
      updatedAt: stamp,
    };
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ revision: 2, recovery, stale: true }));
    const { client, restore, last } = setup(request);
    await client.load();
    expect(restore).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ status: 'conflict', remote: recovery });
    client.update(later);
    expect(await client.flush()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
  });

  it('serializes a newer edit behind the current acknowledgement', async () => {
    let finish!: (value: Response) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ revision: 2, updatedAt: stamp }));
    const { client, last } = setup(request);
    await client.load();
    client.update(changed);
    const work = client.flush();
    client.update(later);
    expect(last().protected).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    finish(Response.json({ revision: 1, updatedAt: stamp }));
    expect(await work).toBe(true);
    const packet = JSON.parse(request.mock.calls[2]![1].body);
    expect(packet).toMatchObject({
      revision: 1,
      fields: later,
      baseUpdatedAt: target.baseUpdatedAt,
    });
    expect(last()).toMatchObject({ status: 'saved', protected: true });
  });

  it('retries an uncertain request with the same mutation before saving newer fields', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockRejectedValueOnce(new TypeError('Response lost after commit'))
      .mockResolvedValueOnce(Response.json({ revision: 1, updatedAt: stamp }))
      .mockResolvedValueOnce(Response.json({ revision: 2, updatedAt: stamp }));
    const { client, last } = setup(request);
    await client.load();
    client.update(changed);
    expect(await client.flush()).toBe(false);
    expect(last()).toMatchObject({ status: 'error', protected: false });
    client.update(later);
    await client.retry();
    expect(request.mock.calls[2]![1].body).toBe(request.mock.calls[1]![1].body);
    expect(JSON.parse(request.mock.calls[3]![1].body)).toMatchObject({
      revision: 1,
      fields: later,
    });
    expect(last().protected).toBe(true);
  });

  it('does not hide an uncertain write when fields return to their original value', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockRejectedValueOnce(new TypeError('Response lost'))
      .mockResolvedValueOnce(Response.json({ revision: 1, updatedAt: stamp }))
      .mockResolvedValueOnce(Response.json({ revision: 2, updatedAt: stamp }));
    const { client } = setup(request);
    await client.load();
    client.update(changed);
    await client.flush();
    client.update(initial);
    await client.retry();
    expect(JSON.parse(request.mock.calls[3]![1].body).fields).toEqual(initial);
  });

  it('preserves local text and does not silently adopt another view revision on conflict', async () => {
    const remote = {
      fields: later,
      kind: target.kind,
      baseUpdatedAt: target.baseUpdatedAt,
      updatedAt: stamp,
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockResolvedValueOnce(Response.json({ error: 'Conflict' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ revision: 9, recovery: remote, stale: false }));
    const { client, last, restore } = setup(request);
    await client.load();
    client.update(changed);
    await client.flush();
    await client.inspectConflict();
    expect(last()).toMatchObject({ status: 'conflict', protected: false, remote });
    expect(client.getRevision()).toBe(0);
    expect(restore).not.toHaveBeenCalled();
    await client.retry();
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('does not repeatedly defer the checkpoint during continuous typing', async () => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockResolvedValue(Response.json({ revision: 1, updatedAt: stamp }));
    const { client } = setup(request, 500);
    await client.load();
    client.update(changed);
    await vi.advanceTimersByTimeAsync(300);
    client.update(later);
    await vi.advanceTimersByTimeAsync(200);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1]![1].body).fields).toEqual(later);
  });

  it('ignores a late hydration response after leaving', async () => {
    let finish!: (value: Response) => void;
    const request = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const { client, restore } = setup(request);
    const work = client.load();
    client.dispose();
    finish(
      Response.json({
        revision: 1,
        stale: false,
        recovery: {
          fields: changed,
          kind: target.kind,
          baseUpdatedAt: target.baseUpdatedAt,
          updatedAt: stamp,
        },
      }),
    );
    await work;
    expect(restore).not.toHaveBeenCalled();
  });

  it('does not start queued writes after unmount, even when an older write finishes', async () => {
    let finish!: (value: Response) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(empty()))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      );
    const { client } = setup(request);
    await client.load();
    client.update(changed);
    const work = client.flush();
    client.update(later);
    client.dispose();
    finish(Response.json({ revision: 1, updatedAt: stamp }));
    await work;
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('only acknowledges discard after server deletion; lost responses retry the same operation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          revision: 1,
          stale: false,
          recovery: {
            fields: changed,
            kind: target.kind,
            baseUpdatedAt: target.baseUpdatedAt,
            updatedAt: stamp,
          },
        }),
      )
      .mockRejectedValueOnce(new TypeError('Lost discard response'))
      .mockResolvedValueOnce(Response.json({ revision: 2 }));
    const { client, last } = setup(request);
    await client.load();
    expect(await client.discard()).toBe(false);
    expect(last().status).toBe('error');
    expect(await client.discard()).toBe(true);
    expect(request.mock.calls[2]![1].body).toBe(request.mock.calls[1]![1].body);
    expect(last()).toMatchObject({ status: 'ready', protected: true, restored: false });
  });

  it('rejects malformed hydration rather than dropping or inventing field values', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        revision: 1,
        stale: false,
        recovery: { fields: { subjective: 'Only one field' } },
      }),
    );
    const { client, last, restore } = setup(request);
    await client.load();
    expect(last().status).toBe('error');
    expect(client.isHydrated()).toBe(false);
    expect(restore).not.toHaveBeenCalled();
  });
});
