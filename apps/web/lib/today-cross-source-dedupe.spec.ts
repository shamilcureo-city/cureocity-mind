import { describe, expect, it } from 'vitest';
import { dedupeTodayCrossSource } from './today-cross-source-dedupe';
import { dedupeLatestShareActivity } from './client-care-home-dedupe';

describe('Today cross-source deduplication', () => {
  it('collapses check-in plus share-open and homework-response plus overdue rows', () => {
    const rows = [
      {
        id: 'checkin:r1',
        clientId: 'c1',
        event: 'CHECKIN_RESPONSE' as const,
        occurredAt: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 'share:s1',
        clientId: 'c1',
        event: 'SHARE_OPEN' as const,
        occurredAt: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 'homework:a1',
        clientId: 'c1',
        assignmentId: 'a1',
        event: 'HOMEWORK_RESPONSE' as const,
        occurredAt: '2026-09-01T11:00:00.000Z',
      },
      {
        id: 'a1',
        clientId: 'c1',
        assignmentId: 'a1',
        event: 'HOMEWORK_OVERDUE' as const,
        occurredAt: '2026-08-31T11:00:00.000Z',
      },
    ];
    expect(dedupeTodayCrossSource(rows).map((row) => row.id)).toEqual([
      'checkin:r1',
      'homework:a1',
    ]);
  });

  it('dedupes a later check-in response against its accepted share provenance, not timestamp', () => {
    const rows = [
      {
        id: 'checkin:r2',
        clientId: 'c1',
        event: 'CHECKIN_RESPONSE' as const,
        occurredAt: '2026-09-01T10:05:00.000Z',
        sourceShareId: 's2',
        sourceShareBatchId: 'batch-2',
      },
      {
        id: 'share:s2',
        clientId: 'c1',
        event: 'SHARE_OPEN' as const,
        occurredAt: '2026-09-01T10:00:00.000Z',
        shareId: 's2',
        shareBatchId: 'batch-2',
      },
    ];
    expect(dedupeTodayCrossSource(rows).map((row) => row.id)).toEqual(['checkin:r2']);
  });

  it('keeps grouped partial-channel failure information when a batch also opened', () => {
    const grouped = dedupeLatestShareActivity(
      [
        {
          id: 'open',
          shareBatchId: 'batch-3',
          status: 'OPENED',
          createdAt: new Date('2026-09-01T10:00:00.000Z'),
          openedAt: new Date('2026-09-01T10:02:00.000Z'),
        },
        {
          id: 'failed',
          shareBatchId: 'batch-3',
          status: 'PERMANENT_FAILURE',
          createdAt: new Date('2026-09-01T10:01:00.000Z'),
          openedAt: null,
        },
      ],
      8,
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({ hasOpened: true, hasFailure: true });
    expect(grouped[0]?.groupedStatuses).toEqual(['OPENED', 'PERMANENT_FAILURE']);
  });
});
