import { describe, expect, it } from 'vitest';
import {
  MindWorkHistoryEntrySchema,
  MindWorkHistoryPageSchema,
  MindWorkHistoryQuerySchema,
} from './mind-work-history';

const entry = {
  recordVersion: 3,
  savedAt: '2026-09-14T10:00:00.000Z',
  work: {
    sessionId: 'fictional-visit',
    scheduledAt: '2026-09-13T10:00:00.000Z',
    disposition: 'PAUSED',
    workDone: 'Fictional work paused after discussion.',
    clientResponse: '',
  },
};
const page = {
  clientId: 'fictional-client',
  snapshotVersion: 3,
  beforeVersion: null,
  nextBeforeVersion: null,
  entries: [entry],
  hasMore: false,
};

describe('Mind work history query', () => {
  it('accepts the initial request and coerces paired continuation cursors', () => {
    expect(MindWorkHistoryQuerySchema.parse({})).toEqual({});
    expect(MindWorkHistoryQuerySchema.parse({ snapshotVersion: '30', beforeVersion: '6' })).toEqual(
      {
        snapshotVersion: 30,
        beforeVersion: 6,
      },
    );
  });
  it.each([
    { snapshotVersion: 1 },
    { beforeVersion: 1 },
    { snapshotVersion: 1, beforeVersion: 2 },
    { snapshotVersion: 0, beforeVersion: 1 },
    { snapshotVersion: 1.5, beforeVersion: 1 },
    { snapshotVersion: 2_147_483_648, beforeVersion: 1 },
    { snapshotVersion: 'bad', beforeVersion: 1 },
    { snapshotVersion: 1, beforeVersion: -1 },
    { sessionId: 'another-visit' },
    { limit: 1000 },
  ])('rejects malformed or unbounded query %j', (query) => {
    expect(MindWorkHistoryQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('Mind work history page', () => {
  it('preserves unknown client response and explicit paused/not-used work', () => {
    expect(MindWorkHistoryPageSchema.parse(page).entries[0]?.work.clientResponse).toBe('');
    expect(
      MindWorkHistoryEntrySchema.parse({
        ...entry,
        work: { ...entry.work, disposition: 'NOT_USED' },
      }).work.disposition,
    ).toBe('NOT_USED');
  });
  it('represents no stored versions separately from a page with no changes', () => {
    expect(
      MindWorkHistoryPageSchema.parse({ ...page, snapshotVersion: 0, entries: [] }).hasMore,
    ).toBe(false);
    expect(
      MindWorkHistoryPageSchema.parse({
        ...page,
        snapshotVersion: 30,
        entries: [],
        nextBeforeVersion: 6,
        hasMore: true,
      }).hasMore,
    ).toBe(true);
  });
  it('accepts a bounded continuation and an explicitly exhausted cursor', () => {
    expect(
      MindWorkHistoryPageSchema.parse({ ...page, snapshotVersion: 30, beforeVersion: 6 }),
    ).toBeTruthy();
    expect(
      MindWorkHistoryPageSchema.parse({ ...page, beforeVersion: 1, entries: [] }).entries,
    ).toEqual([]);
  });
  it.each([
    { ...page, bodyEncrypted: 'not-a-disclosure' },
    { ...page, snapshotVersion: 0 },
    { ...page, beforeVersion: 4 },
    { ...page, beforeVersion: 3 },
    { ...page, snapshotVersion: 30, hasMore: false },
    { ...page, snapshotVersion: 30, nextBeforeVersion: 7, hasMore: true },
    { ...page, entries: [entry, entry] },
    { ...page, entries: [{ ...entry, recordVersion: 2 }, entry] },
    { ...page, entries: [{ ...entry, operationId: 'not-a-disclosure' }] },
    { ...page, entries: [{ ...entry, savedAt: 'yesterday' }] },
    { ...page, entries: [{ ...entry, work: { ...entry.work, workDone: '' } }] },
    { ...page, entries: [{ ...entry, work: { ...entry.work, clinicianVerified: true } }] },
    { ...page, entries: Array.from({ length: 26 }, () => entry) },
  ])('rejects malformed, unsafe or contradictory page %j', (value) => {
    expect(MindWorkHistoryPageSchema.safeParse(value).success).toBe(false);
  });
});
