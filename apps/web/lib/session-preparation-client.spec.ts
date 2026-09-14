import { describe, expect, it, vi } from 'vitest';
import { SessionPreparationClient, type PreparationSnapshot } from './session-preparation-client';

const operationId = 'a6e4e83a-8507-4db2-ac68-1b70ff356859';
const secondOperationId = 'd75d6564-e498-4dc1-87a8-44b106050c6c';
const date = '2026-09-13T09:00:00.000Z';
const snapshot = (sessionId = 'visit-1', clientId = 'client-1'): PreparationSnapshot => ({
  sessionId,
  clientId,
  scheduledAt: date,
  status: 'SCHEDULED',
  preparation: null,
});
function receipt(input: RequestInit, visit = snapshot()) {
  const body = JSON.parse(String(input.body));
  return {
    ...visit,
    preparation: {
      id: 'preparation-1',
      sessionId: visit.sessionId,
      psychologistId: 'psychologist-1',
      revision: body.expectedRevision + 1,
      operationId: body.operationId,
      body: {
        version: 1 as const,
        focus: body.focus,
        source: 'CLINICIAN_WRITTEN' as const,
        scheduledAt: body.expectedScheduledAt,
      },
      createdAt: date,
    },
    currentRevision: body.expectedRevision + 1,
    replayed: false,
  };
}
function fixture(visit = snapshot(), readOnly = false) {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(async (_url, input) =>
      input?.method === 'POST' ? Response.json(receipt(input, visit)) : Response.json(visit),
    );
  const changed = vi.fn();
  const makeId = vi.fn().mockReturnValueOnce(operationId).mockReturnValue(secondOperationId);
  const client = new SessionPreparationClient(
    visit.sessionId,
    visit.clientId,
    changed,
    request,
    readOnly,
    makeId,
  );
  return { client, request, changed, makeId };
}
const posts = (request: ReturnType<typeof fixture>['request']) =>
  request.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('session-bound explicit preparation client', () => {
  it('does not save by opening or typing and uses exact visit identity only after adoption', async () => {
    const { client, request } = fixture();
    await client.load();
    expect(client.update('  Discuss sleep routine  ')).toBe(true);
    expect(posts(request)).toHaveLength(0);
    expect(await client.save()).toBe(true);
    expect(posts(request)[0][0]).toBe('/api/v1/sessions/visit-1/preparation');
    expect(JSON.parse(String(posts(request)[0][1]!.body))).toEqual({
      operationId,
      expectedRevision: 0,
      expectedClientId: 'client-1',
      expectedScheduledAt: date,
      action: 'SAVE',
      focus: 'Discuss sleep routine',
    });
    expect(client.getState()).toMatchObject({
      phase: 'saved',
      pending: false,
      draft: 'Discuss sleep routine',
    });
  });
  it('keeps two same-day visits independent even for the same client', async () => {
    const first = fixture();
    const second = fixture(snapshot('visit-2'));
    await Promise.all([first.client.load(), second.client.load()]);
    first.client.update('First visit focus');
    second.client.update('Second visit focus');
    await Promise.all([first.client.save(), second.client.save()]);
    expect(first.client.getState().snapshot?.preparation?.body.focus).toBe('First visit focus');
    expect(second.client.getState().snapshot?.preparation?.body.focus).toBe('Second visit focus');
    expect(posts(second.request)[0][0]).toContain('visit-2');
  });
  it.each(['client', 'session', 'record-session'])(
    'rejects a GET with mismatched %s identity',
    async (kind) => {
      const { client, request } = fixture();
      const invalid: Record<string, unknown> = snapshot();
      if (kind === 'client') invalid.clientId = 'other-client';
      if (kind === 'session') invalid.sessionId = 'other-visit';
      if (kind === 'record-session')
        invalid.preparation = receipt(
          {
            body: JSON.stringify({
              operationId,
              expectedRevision: 0,
              expectedScheduledAt: date,
              focus: 'Other visit',
            }),
          },
          snapshot('other-visit'),
        ).preparation;
      request.mockResolvedValueOnce(Response.json(invalid));
      expect(await client.load()).toBe(false);
      expect(client.getState().snapshot).toBeNull();
      expect(client.update('Never adopt')).toBe(false);
      expect(await client.save()).toBe(false);
      expect(posts(request)).toHaveLength(0);
    },
  );
  it('does not interpret unreadable/unavailable history as empty or permit overwrites', async () => {
    const { client, request } = fixture();
    request.mockResolvedValueOnce(Response.json({ error: 'UNREADABLE' }, { status: 503 }));
    await client.load();
    expect(client.getState()).toMatchObject({ phase: 'unavailable', snapshot: null });
    expect(client.getState().message).toContain('not being treated as empty');
    expect(await client.save()).toBe(false);
  });
  it.each([true, false])('forbids writing in read-only context (%s)', async (readOnly) => {
    const { client, request } = fixture(
      { ...snapshot(), status: readOnly ? 'SCHEDULED' : 'IN_PROGRESS' },
      readOnly,
    );
    await client.load();
    expect(client.update('No write')).toBe(false);
    expect(await client.save()).toBe(false);
    expect(posts(request)).toHaveLength(0);
  });
  it('requires nonempty bounded focus; discard never creates a save', async () => {
    const { client, request } = fixture();
    await client.load();
    expect(client.update('x'.repeat(201))).toBe(false);
    client.update('  ');
    expect(await client.save()).toBe(false);
    client.update('Do not adopt this');
    expect(client.discardDraft()).toBe(true);
    expect(client.getState().draft).toBe('');
    expect(posts(request)).toHaveLength(0);
  });
  it('retains exact operation after a lost response and blocks new writes or loads until receipt', async () => {
    const { client, request, makeId } = fixture();
    await client.load();
    client.update('Keep original wording');
    request.mockRejectedValueOnce(new Error('Lost response'));
    expect(await client.save()).toBe(false);
    expect(client.getState()).toMatchObject({
      phase: 'ambiguous',
      pending: true,
      draft: 'Keep original wording',
    });
    expect(client.update('Replacement')).toBe(false);
    expect(client.discardDraft()).toBe(false);
    expect(await client.load(true)).toBe(false);
    expect(await client.save('CLEAR')).toBe(false);
    expect(await client.retry()).toBe(true);
    expect(posts(request)[0][1]!.body).toEqual(posts(request)[1][1]!.body);
    expect(makeId).toHaveBeenCalledTimes(1);
  });
  it.each([408, 429, 500, 503])('retains retry identity on uncertain HTTP %s', async (status) => {
    const { client, request } = fixture();
    await client.load();
    client.update('Preserve wording');
    request.mockResolvedValueOnce(Response.json({}, { status }));
    await client.save();
    expect(client.getState().pending).toBe(true);
    await client.retry();
    expect(posts(request)[0][1]!.body).toEqual(posts(request)[1][1]!.body);
  });
  it.each([
    'session',
    'client',
    'revision',
    'operation',
    'focus',
    'schedule',
    'currentRevision',
    'json',
  ])('does not claim saved for a malformed/mismatched %s receipt', async (kind) => {
    const { client, request } = fixture();
    await client.load();
    client.update('Preserve wording');
    request.mockImplementationOnce(async (_url, input) => {
      const result = receipt(input!);
      if (kind === 'session') result.sessionId = 'other';
      if (kind === 'client') result.clientId = 'other';
      if (kind === 'revision') result.preparation.revision = 22;
      if (kind === 'operation') result.preparation.operationId = secondOperationId;
      if (kind === 'focus') result.preparation.body.focus = 'Other wording';
      if (kind === 'schedule') result.preparation.body.scheduledAt = '2026-09-13T10:00:00.000Z';
      if (kind === 'currentRevision') result.currentRevision = 0;
      return kind === 'json' ? new Response('not json') : Response.json(result);
    });
    expect(await client.save()).toBe(false);
    expect(client.getState()).toMatchObject({ phase: 'ambiguous', pending: true });
    await client.retry();
    expect(posts(request)[0][1]!.body).toEqual(posts(request)[1][1]!.body);
  });
  it('serializes double-clicks into one post and accepts only acknowledged content', async () => {
    const { client, request } = fixture();
    await client.load();
    client.update('One action');
    const [first, second] = await Promise.all([client.save(), client.save()]);
    expect(first && second).toBe(true);
    expect(posts(request)).toHaveLength(1);
  });
  it('preserves wording on conflict, reviews latest revision and requires a fresh explicit adoption', async () => {
    const { client, request } = fixture();
    await client.load();
    client.update('My unsaved wording');
    request.mockResolvedValueOnce(Response.json({}, { status: 409 }));
    await client.save();
    expect(client.getState()).toMatchObject({
      phase: 'conflict',
      pending: false,
      draft: 'My unsaved wording',
    });
    expect(await client.save()).toBe(false);
    const latest = receipt({
      body: JSON.stringify({
        operationId: secondOperationId,
        expectedRevision: 1,
        expectedScheduledAt: date,
        focus: 'Other view wording',
      }),
    });
    request.mockResolvedValueOnce(
      Response.json({ ...snapshot(), preparation: latest.preparation }),
    );
    await client.load(true);
    expect(client.getState().draft).toBe('My unsaved wording');
    expect(client.getState().snapshot?.preparation?.body.focus).toBe('Other view wording');
    expect(posts(request)).toHaveLength(1);
    await client.save();
    expect(JSON.parse(String(posts(request)[1][1]!.body))).toMatchObject({
      expectedRevision: 2,
      operationId: secondOperationId,
      focus: 'My unsaved wording',
    });
  });
  it('can acknowledge a timed-out save after parent locks edits or visit starts', async () => {
    const { client, request } = fixture();
    await client.load();
    client.update('Original planned focus');
    request.mockRejectedValueOnce(new Error('Lost receipt'));
    await client.save();
    client.setReadOnly(true);
    request.mockImplementationOnce(async (_url, input) =>
      Response.json({ ...receipt(input!), status: 'IN_PROGRESS', replayed: true }),
    );
    expect(client.getState().pending).toBe(true);
    expect(await client.retry()).toBe(true);
    expect(client.getState()).toMatchObject({ phase: 'saved', pending: false });
    expect(client.update('Too late')).toBe(false);
  });
  it('never confuses an original replay receipt with a newer saved revision', async () => {
    const { client, request } = fixture();
    await client.load();
    client.update('Original planned focus');
    request.mockImplementationOnce(async (_url, input) =>
      Response.json({ ...receipt(input!), currentRevision: 3, replayed: true }),
    );
    expect(await client.save()).toBe(true);
    expect(client.getState()).toMatchObject({ phase: 'conflict', pending: false });
    expect(await client.save()).toBe(false);
  });
  it('a clear appends the next revision and is not an empty save', async () => {
    const record = receipt({
      body: JSON.stringify({
        operationId,
        expectedRevision: 0,
        expectedScheduledAt: date,
        focus: 'Original focus',
      }),
    }).preparation;
    const { client, request } = fixture({ ...snapshot(), preparation: record });
    await client.load();
    await client.save('CLEAR');
    expect(JSON.parse(String(posts(request)[0][1]!.body))).toMatchObject({
      expectedRevision: 1,
      action: 'CLEAR',
      focus: null,
    });
    expect(client.getState().snapshot?.preparation?.revision).toBe(2);
    expect(client.getState().message).toContain('Earlier versions are retained');
  });
  it('does not publish late data after component disposal', async () => {
    const { client, request, changed } = fixture();
    let finish!: (response: Response) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const loading = client.load();
    client.dispose();
    const before = changed.mock.calls.length;
    finish(Response.json(snapshot()));
    await loading;
    expect(changed).toHaveBeenCalledTimes(before);
    expect(client.getState().snapshot).toBeNull();
  });
});
