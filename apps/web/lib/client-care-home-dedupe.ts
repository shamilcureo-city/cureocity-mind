export function dedupeLatestCareShares<T extends { artefactType: string; artefactId: string }>(
  rowsNewestFirst: readonly T[],
): T[] {
  const seen = new Set<string>();
  return rowsNewestFirst.filter((row) => {
    const key = `${row.artefactType}:${row.artefactId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function partitionCareShareHistory<T extends { artefactType: string; artefactId: string }>(
  rowsNewestFirst: readonly T[],
  limit = 100,
): { summary: T[]; history: T[] } {
  return {
    summary: dedupeLatestCareShares(rowsNewestFirst).slice(0, limit),
    history: rowsNewestFirst.slice(0, limit),
  };
}

export interface GroupedShareActivity {
  groupedStatuses: string[];
  hasOpened: boolean;
  hasFailure: boolean;
}

export function dedupeLatestShareActivity<
  T extends {
    id: string;
    shareBatchId: string | null;
    status?: string;
    createdAt: Date;
    openedAt: Date | null;
  },
>(rows: readonly T[], limit: number): Array<T & GroupedShareActivity> {
  const newestFirst = [...rows].sort((a, b) => {
    const activityDelta =
      (b.openedAt ?? b.createdAt).getTime() - (a.openedAt ?? a.createdAt).getTime();
    return activityDelta !== 0 ? activityDelta : b.id.localeCompare(a.id);
  });
  const grouped = new Map<string, T[]>();
  for (const row of newestFirst) {
    const key = row.shareBatchId ?? row.id;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()].slice(0, limit).map((group) => {
    const representative = group[0]!;
    return {
      ...representative,
      groupedStatuses: [
        ...new Set(group.map((row) => row.status).filter((status): status is string => !!status)),
      ],
      hasOpened: group.some((row) => row.openedAt !== null || row.status === 'OPENED'),
      hasFailure: group.some((row) => row.status?.endsWith('FAILURE') === true),
    };
  });
}

export function dedupeLatestShareBatches<T extends { id: string; shareBatchId: string | null }>(
  rowsNewestFirst: readonly T[],
): T[] {
  const seen = new Set<string>();
  return rowsNewestFirst.filter((row) => {
    const key = row.shareBatchId ?? row.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
