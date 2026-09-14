import {
  MindWorkHistoryPageSchema,
  MindWorkHistoryQuerySchema,
  type MindWorkHistoryEntry,
  type MindWorkHistoryPage,
} from '@cureocity/contracts';

export type MindWorkHistoryCursor = { snapshotVersion: number; beforeVersion: number };
export type MindWorkHistoryRequest = { clientId: string; cursor: MindWorkHistoryCursor | null };
export type MindWorkHistoryFailure = 'network' | 'access' | 'protocol' | 'server';

export class MindWorkHistoryError extends Error {
  constructor(readonly kind: MindWorkHistoryFailure) {
    super(
      kind === 'access'
        ? 'Work history is unavailable for this client.'
        : kind === 'network'
          ? 'The connection was interrupted. No history is shown.'
          : 'Verified work history could not be loaded. No history is shown.',
    );
    this.name = 'MindWorkHistoryError';
  }
}

/** Validate the page against the request, not just against its standalone DTO. */
export function readMindWorkHistoryPage(
  value: unknown,
  expected: MindWorkHistoryRequest,
): MindWorkHistoryPage {
  const parsed = MindWorkHistoryPageSchema.safeParse(value);
  if (!parsed.success) throw new MindWorkHistoryError('protocol');
  const page = parsed.data;
  const upper = expected.cursor?.beforeVersion ?? page.snapshotVersion + 1;
  if (
    page.clientId !== expected.clientId ||
    page.beforeVersion !== (expected.cursor?.beforeVersion ?? null) ||
    (expected.cursor && page.snapshotVersion !== expected.cursor.snapshotVersion) ||
    (expected.cursor &&
      (!Number.isInteger(expected.cursor.snapshotVersion) ||
        expected.cursor.snapshotVersion < 1 ||
        !Number.isInteger(expected.cursor.beforeVersion) ||
        expected.cursor.beforeVersion < 1 ||
        expected.cursor.beforeVersion > expected.cursor.snapshotVersion)) ||
    page.entries.some(
      (entry, index) =>
        entry.recordVersion > page.snapshotVersion ||
        entry.recordVersion >= upper ||
        (index > 0 && entry.recordVersion >= page.entries[index - 1]!.recordVersion),
    ) ||
    (page.hasMore
      ? page.nextBeforeVersion === null ||
        page.nextBeforeVersion < 1 ||
        page.nextBeforeVersion >= upper ||
        page.entries.some((entry) => entry.recordVersion < page.nextBeforeVersion!)
      : page.nextBeforeVersion !== null) ||
    (page.snapshotVersion === 0 &&
      (page.entries.length !== 0 || page.hasMore || page.beforeVersion !== null))
  )
    throw new MindWorkHistoryError('protocol');
  return page;
}

export async function loadMindWorkHistoryPage(
  expected: MindWorkHistoryRequest,
  { request = fetch, signal }: { request?: typeof fetch; signal?: AbortSignal } = {},
): Promise<MindWorkHistoryPage> {
  if (
    !expected.clientId ||
    expected.clientId.length > 200 ||
    !MindWorkHistoryQuerySchema.safeParse(expected.cursor ?? {}).success
  )
    throw new MindWorkHistoryError('protocol');
  const query = expected.cursor
    ? `?${new URLSearchParams({
        snapshotVersion: String(expected.cursor.snapshotVersion),
        beforeVersion: String(expected.cursor.beforeVersion),
      })}`
    : '';
  const effectiveSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
    : AbortSignal.timeout(20_000);
  if (effectiveSignal.aborted) throw new MindWorkHistoryError('network');
  let response: Response;
  try {
    response = await request(
      `/api/v1/clients/${encodeURIComponent(expected.clientId)}/session-work-history${query}`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { accept: 'application/json' },
        signal: effectiveSignal,
      },
    );
  } catch {
    throw new MindWorkHistoryError('network');
  }
  if (effectiveSignal.aborted) throw new MindWorkHistoryError('network');
  if (!response.ok)
    throw new MindWorkHistoryError([401, 403, 404].includes(response.status) ? 'access' : 'server');
  let body: unknown;
  try {
    body = await response.json();
  } catch (cause) {
    throw new MindWorkHistoryError(
      cause instanceof Error && ['TypeError', 'AbortError', 'TimeoutError'].includes(cause.name)
        ? 'network'
        : 'protocol',
    );
  }
  if (effectiveSignal.aborted) throw new MindWorkHistoryError('network');
  return readMindWorkHistoryPage(body, expected);
}

/** Pages move backwards. Never replace newer wording with an older appended record. */
export function appendMindWorkHistoryEntries(
  current: MindWorkHistoryEntry[],
  next: MindWorkHistoryEntry[],
): MindWorkHistoryEntry[] {
  const combined = [...current, ...next];
  if (
    combined.some(
      (entry, index) => index > 0 && entry.recordVersion >= combined[index - 1]!.recordVersion,
    )
  )
    throw new MindWorkHistoryError('protocol');
  return combined;
}

export function groupMindWorkHistory(entries: MindWorkHistoryEntry[]): {
  sessionId: string;
  latest: MindWorkHistoryEntry;
  previous: MindWorkHistoryEntry[];
}[] {
  const groups = new Map<
    string,
    { sessionId: string; latest: MindWorkHistoryEntry; previous: MindWorkHistoryEntry[] }
  >();
  for (const entry of entries) {
    const group = groups.get(entry.work.sessionId);
    if (group) group.previous.push(entry);
    else
      groups.set(entry.work.sessionId, {
        sessionId: entry.work.sessionId,
        latest: entry,
        previous: [],
      });
  }
  return [...groups.values()];
}
