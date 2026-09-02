export type TodaySourceEvent =
  | 'CHECKIN_RESPONSE'
  | 'SHARE_OPEN'
  | 'SHARE_FAILURE'
  | 'HOMEWORK_RESPONSE'
  | 'HOMEWORK_OVERDUE'
  | 'OTHER';

export function dedupeTodayCrossSource<
  T extends {
    clientId?: string;
    event?: TodaySourceEvent;
    occurredAt: string;
    assignmentId?: string;
    shareId?: string;
    shareBatchId?: string;
    sourceShareId?: string;
    sourceShareBatchId?: string;
  },
>(rows: readonly T[]): T[] {
  const respondedAssignments = new Set(
    rows
      .filter((row) => row.event === 'HOMEWORK_RESPONSE' && row.assignmentId)
      .map((row) => row.assignmentId!),
  );
  const clinicalResponseRows = rows.filter(
    (row) => row.event === 'CHECKIN_RESPONSE' || row.event === 'HOMEWORK_RESPONSE',
  );
  const clinicalResponseMoments = new Set(
    clinicalResponseRows
      .filter((row) => row.clientId)
      .map((row) => `${row.clientId}:${row.occurredAt}`),
  );
  const responseShareIds = new Set(
    clinicalResponseRows.map((row) => row.sourceShareId).filter((id): id is string => !!id),
  );
  const responseBatchIds = new Set(
    clinicalResponseRows.map((row) => row.sourceShareBatchId).filter((id): id is string => !!id),
  );
  return rows.filter((row) => {
    if (row.event === 'HOMEWORK_OVERDUE' && row.assignmentId) {
      return !respondedAssignments.has(row.assignmentId);
    }
    if (row.event === 'SHARE_OPEN' && row.clientId) {
      if (row.shareId && responseShareIds.has(row.shareId)) return false;
      if (row.shareBatchId && responseBatchIds.has(row.shareBatchId)) return false;
      // Legacy rows predate durable provenance; retain the old exact-moment
      // fallback without using it for newly attributed responses.
      return !clinicalResponseMoments.has(`${row.clientId}:${row.occurredAt}`);
    }
    return true;
  });
}
