import { describe, expect, it } from 'vitest';
import {
  dedupeLatestCareShares,
  dedupeLatestShareActivity,
  dedupeLatestShareBatches,
  partitionCareShareHistory,
} from './client-care-home-dedupe';

describe('client care share deduplication', () => {
  it('keeps the newest multi-channel receipt for each artefact', () => {
    const rows = [
      { id: 'new', artefactType: 'HOMEWORK', artefactId: 'a1' },
      { id: 'other', artefactType: 'TREATMENT_PLAN', artefactId: 'p1' },
      { id: 'old', artefactType: 'HOMEWORK', artefactId: 'a1' },
    ];
    expect(dedupeLatestCareShares(rows).map((row) => row.id)).toEqual(['new', 'other']);
  });

  it('dedupes summary cards while preserving repeated bounded history events', () => {
    const rows = Array.from({ length: 105 }, (_, index) => ({
      id: `event-${index}`,
      artefactType: 'HOMEWORK',
      artefactId: index < 2 ? 'same-homework' : `homework-${index}`,
    }));
    const result = partitionCareShareHistory(rows);
    expect(result.summary.map((row) => row.id).slice(0, 2)).toEqual(['event-0', 'event-2']);
    expect(result.history).toHaveLength(100);
    expect(result.history.slice(0, 2).map((row) => row.id)).toEqual(['event-0', 'event-1']);
  });

  it('sorts by actual activity before deduping fanout batches', () => {
    const rows = [
      {
        id: 'created-later',
        shareBatchId: 'batch-1',
        createdAt: new Date('2026-09-01T12:00:00Z'),
        openedAt: null,
      },
      {
        id: 'opened-latest',
        shareBatchId: 'batch-2',
        createdAt: new Date('2026-08-30T12:00:00Z'),
        openedAt: new Date('2026-09-01T14:00:00Z'),
      },
      {
        id: 'batch-2-sibling',
        shareBatchId: 'batch-2',
        createdAt: new Date('2026-08-30T12:01:00Z'),
        openedAt: null,
      },
    ];
    expect(dedupeLatestShareActivity(rows, 8).map((row) => row.id)).toEqual([
      'opened-latest',
      'created-later',
    ]);
  });

  it('keeps only the newest channel activity for one fanout batch', () => {
    const rows = [
      { id: 'new', shareBatchId: 'batch-1' },
      { id: 'other', shareBatchId: null },
      { id: 'old', shareBatchId: 'batch-1' },
    ];
    expect(dedupeLatestShareBatches(rows).map((row) => row.id)).toEqual(['new', 'other']);
  });
});
