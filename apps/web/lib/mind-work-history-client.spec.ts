import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindWorkHistoryEntry } from '@cureocity/contracts';
import {
  appendMindWorkHistoryEntries,
  groupMindWorkHistory,
  loadMindWorkHistoryPage,
  readMindWorkHistoryPage,
} from './mind-work-history-client';

const entry = (
  recordVersion: number,
  sessionId = 'visit-a',
  wording = `Saved work ${recordVersion}`,
): MindWorkHistoryEntry => ({
  recordVersion,
  savedAt: '2026-09-14T09:00:00.000Z',
  work: {
    sessionId,
    scheduledAt: '2026-09-08T09:00:00.000Z',
    disposition: 'ADAPTED',
    workDone: wording,
    clientResponse: '',
  },
});
const page = (overrides: Record<string, unknown> = {}) => ({
  clientId: 'client-a',
  snapshotVersion: 75,
  beforeVersion: null,
  nextBeforeVersion: 51,
  entries: [entry(70), entry(60, 'visit-b')],
  hasMore: true,
  ...overrides,
});
const first = { clientId: 'client-a', cursor: null };
const second = { clientId: 'client-a', cursor: { snapshotVersion: 75, beforeVersion: 51 } };
afterEach(() => vi.restoreAllMocks());

describe('work-history request-bound decoding', () => {
  it('accepts a valid first page and an empty bounded continuation', () => {
    expect(readMindWorkHistoryPage(page(), first).entries).toHaveLength(2);
    expect(
      readMindWorkHistoryPage(
        page({ beforeVersion: 51, nextBeforeVersion: 26, entries: [] }),
        second,
      ).hasMore,
    ).toBe(true);
  });
  it('accepts a genuinely empty zero-version snapshot', () => {
    expect(
      readMindWorkHistoryPage(
        page({ snapshotVersion: 0, nextBeforeVersion: null, entries: [], hasMore: false }),
        first,
      ).snapshotVersion,
    ).toBe(0);
  });
  it.each([
    { clientId: 'wrong-client' },
    { beforeVersion: 51, nextBeforeVersion: 26, entries: [] },
    { nextBeforeVersion: 75 },
    { nextBeforeVersion: 0 },
    { nextBeforeVersion: null },
    { hasMore: false },
    { entries: [entry(76)] },
    { entries: [entry(70), entry(70)] },
    { entries: [entry(60), entry(70)] },
    { entries: [entry(25)] },
    { extraClinicalRecord: 'must not be included' },
    { entries: [{ ...entry(70), savedAt: 'not a date' }] },
  ])('rejects an inconsistent first page %j', (change) => {
    expect(() => readMindWorkHistoryPage(page(change), first)).toThrow();
  });
  it('rejects a changed snapshot even when the returned DTO is independently valid', () => {
    expect(() =>
      readMindWorkHistoryPage(
        page({ snapshotVersion: 80, beforeVersion: 51, nextBeforeVersion: 26, entries: [] }),
        second,
      ),
    ).toThrow();
  });
  it('rejects an echoed cursor from a different continuation', () => {
    expect(() =>
      readMindWorkHistoryPage(
        page({ beforeVersion: 26, nextBeforeVersion: null, hasMore: false, entries: [] }),
        second,
      ),
    ).toThrow();
  });
});

describe('work-history transport', () => {
  it('uses only a no-store GET, with no first-page query and an explicit paired continuation', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page()))
      .mockResolvedValueOnce(
        Response.json(page({ beforeVersion: 51, nextBeforeVersion: 26, entries: [] })),
      );
    await loadMindWorkHistoryPage(first, { request });
    await loadMindWorkHistoryPage(second, { request });
    expect(request.mock.calls[0][0]).toBe('/api/v1/clients/client-a/session-work-history');
    expect(request.mock.calls[1][0]).toBe(
      '/api/v1/clients/client-a/session-work-history?snapshotVersion=75&beforeVersion=51',
    );
    expect(request.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(request.mock.calls[0][1]).not.toHaveProperty('body');
  });
  it('does not dispatch invalid cursors or an already aborted read', async () => {
    const request = vi.fn();
    await expect(
      loadMindWorkHistoryPage(
        { clientId: 'client-a', cursor: { snapshotVersion: 0, beforeVersion: 1 } },
        { request },
      ),
    ).rejects.toMatchObject({ kind: 'protocol' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadMindWorkHistoryPage(first, { request, signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'network' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404])(
    'classifies access failure %s without echoing a response body',
    async (status) => {
      const request = vi
        .fn()
        .mockResolvedValue(Response.json({ error: 'sensitive server details' }, { status }));
      await expect(loadMindWorkHistoryPage(first, { request })).rejects.toMatchObject({
        kind: 'access',
        message: 'Work history is unavailable for this client.',
      });
    },
  );
  it('separates service errors, malformed JSON and network interruption', async () => {
    await expect(
      loadMindWorkHistoryPage(first, {
        request: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
      }),
    ).rejects.toMatchObject({ kind: 'server' });
    await expect(
      loadMindWorkHistoryPage(first, {
        request: vi.fn().mockResolvedValue(new Response('invalid JSON')),
      }),
    ).rejects.toMatchObject({ kind: 'protocol' });
    await expect(
      loadMindWorkHistoryPage(first, {
        request: vi.fn().mockRejectedValue(new TypeError('network unavailable')),
      }),
    ).rejects.toMatchObject({ kind: 'network' });
  });
  it('rejects a JSON body that settles after the combined deadline signal aborts', async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let finish!: (value: unknown) => void;
    const json = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = vi.fn().mockResolvedValue({ ok: true, json } as unknown as Response);
    const pending = loadMindWorkHistoryPage(first, { request });
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    deadline.abort();
    finish(page());
    await expect(pending).rejects.toMatchObject({ kind: 'network' });
  });
  it('classifies an interrupted response body as a retryable network failure', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockRejectedValue(new TypeError('body stream interrupted')),
    } as unknown as Response);
    await expect(loadMindWorkHistoryPage(first, { request })).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('work-history grouping', () => {
  it('groups by source visit in latest-recorded order and never replaces newer wording when appending', () => {
    const latest = [entry(70, 'old-visit', 'Corrected wording'), entry(60, 'new-visit')];
    const joined = appendMindWorkHistoryEntries(latest, [
      entry(20, 'old-visit', 'Earlier wording'),
      entry(10, 'another-visit'),
    ]);
    const groups = groupMindWorkHistory(joined);
    expect(groups.map((group) => group.sessionId)).toEqual([
      'old-visit',
      'new-visit',
      'another-visit',
    ]);
    expect(groups[0]!.latest.work.workDone).toBe('Corrected wording');
    expect(groups[0]!.previous[0]!.work.workDone).toBe('Earlier wording');
    expect(latest).toHaveLength(2);
  });
  it('keeps entries unchanged for an empty continuation and rejects duplicate or forward append', () => {
    const latest = [entry(70), entry(60)];
    expect(appendMindWorkHistoryEntries(latest, [])).toEqual(latest);
    expect(() => appendMindWorkHistoryEntries(latest, [entry(60)])).toThrow();
    expect(() => appendMindWorkHistoryEntries(latest, [entry(20), entry(25)])).toThrow();
  });
});
