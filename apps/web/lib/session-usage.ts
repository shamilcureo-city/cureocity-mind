import { Prisma, type GeminiCallStatus } from '@prisma/client';
import { SessionUsageSummarySchema, type SessionUsageSummary } from '@cureocity/contracts';
import { prisma } from './prisma';
import { hasSessionUsageConnectionStorage } from './session-usage-storage';
import { validateStoredSessionUsage, type StoredSessionUsage } from './session-usage-integrity';

export const LEGACY_LIVE_ROLLUP = 'LIVE_CONSULT_ROLLUP_V1';
export const METERED_USAGE_STATUSES: GeminiCallStatus[] = ['SUCCESS', 'ERROR', 'TIMEOUT'];

export interface UsageCallRow {
  sessionId: string | null;
  pass: string;
  model: string;
  promptVersion: string;
  status: string;
  costInr: Prisma.Decimal | string;
  inputTokens: number;
  outputTokens: number;
}
export type UsageConnectionRow = StoredSessionUsage;
export interface RecordedUsageEntry {
  sessionId: string | null;
  pass: string;
  model: string;
  costInr: Prisma.Decimal;
  records: number;
  tokens: number | null;
  overlap: boolean;
}
const zero = () => new Prisma.Decimal(0);
const sum = (values: (Prisma.Decimal | string)[]) =>
  values.reduce<Prisma.Decimal>((total, value) => total.plus(value), zero());

const receiptFor = validateStoredSessionUsage;

/** Existing logs contain no stable attempt IDs. Do not pretend to reconstruct retries. */
function meteredCalls(rows: UsageCallRow[]) {
  return rows.filter(
    (row) =>
      METERED_USAGE_STATUSES.includes(row.status as GeminiCallStatus) &&
      new Prisma.Decimal(row.costInr).gt(0),
  );
}

/**
 * Exact legacy sentinel only: real PASS_11 reasoning leaves remain real calls.
 * Unknown old/new overlap uses max as a LOWER BOUND, never an additive total.
 * This also preserves the old positive-spend baseline for budget safeguards.
 */
export function recordedUsageEntries(calls: UsageCallRow[], connections: UsageConnectionRow[]) {
  const entries: RecordedUsageEntry[] = [];
  const live = new Map<
    string,
    { legacy: Prisma.Decimal; current: Prisma.Decimal; legacyCount: number; currentCount: number }
  >();
  const bucket = (id: string) => {
    if (!live.has(id))
      live.set(id, { legacy: zero(), current: zero(), legacyCount: 0, currentCount: 0 });
    return live.get(id)!;
  };
  for (const call of meteredCalls(calls)) {
    if (call.promptVersion === LEGACY_LIVE_ROLLUP && call.sessionId) {
      const b = bucket(call.sessionId);
      b.legacy = b.legacy.plus(call.costInr);
      b.legacyCount++;
    } else {
      entries.push({
        sessionId: call.sessionId,
        pass: call.pass,
        model: call.model,
        costInr: new Prisma.Decimal(call.costInr),
        records: 1,
        tokens: call.inputTokens + call.outputTokens,
        overlap: false,
      });
    }
  }
  const seenConnections = new Set<string>();
  for (const connection of connections) {
    if (seenConnections.has(connection.connectionId))
      throw new Error('Duplicate stored usage connection');
    seenConnections.add(connection.connectionId);
    const receipt = receiptFor(connection);
    if (!receipt) continue;
    const b = bucket(connection.sessionId);
    b.current = b.current.plus(receipt.totals.costInr);
    b.currentCount++;
  }
  for (const [sessionId, b] of live) {
    const overlap = b.legacyCount > 0 && b.currentCount > 0;
    entries.push({
      sessionId,
      pass: overlap
        ? 'LIVE_OVERLAP_LOWER_BOUND'
        : b.currentCount
          ? 'LIVE_CONNECTIONS'
          : 'LEGACY_LIVE_ESTIMATE',
      model: overlap
        ? 'Unreconciled live sources'
        : b.currentCount
          ? 'Live connection estimates'
          : 'Legacy live estimate',
      costInr: Prisma.Decimal.max(b.legacy, b.current),
      records: b.currentCount || b.legacyCount,
      tokens: null,
      overlap,
    });
  }
  return entries;
}

export function summarizeSessionUsage(
  sessionId: string,
  calls: UsageCallRow[],
  connections: UsageConnectionRow[],
  storageAvailable = true,
): SessionUsageSummary {
  const ownedCalls = calls.filter((row) => row.sessionId === sessionId);
  const ownedConnections = connections.filter((row) => row.sessionId === sessionId);
  const receipts = ownedConnections.map(receiptFor).filter((row) => row !== null);
  const leaves = meteredCalls(ownedCalls).filter((row) => row.promptVersion !== LEGACY_LIVE_ROLLUP);
  const legacy = meteredCalls(ownedCalls).filter((row) => row.promptVersion === LEGACY_LIVE_ROLLUP);
  const entries = recordedUsageEntries(ownedCalls, ownedConnections);
  const overlap = legacy.length > 0 && receipts.length > 0;
  const hasEvidence = receipts.length > 0 || leaves.length > 0 || legacy.length > 0;
  const reasons = new Set<string>([
    'Not reconciled with provider billing',
    'Client-level AI, hidden retries, hosting and taxes are not included',
  ]);
  if (!storageAvailable) reasons.add('Connection tracking was not available');
  if (ownedConnections.length === 0) reasons.add('No tracked live connections are available');
  if (ownedConnections.some((row) => row.lastSequence === 0))
    reasons.add('A registered connection has no usage receipt');
  if (ownedConnections.some((row) => row.state === 'OPEN'))
    reasons.add('A connection has not reported its final usage');
  if (ownedConnections.some((row) => row.state === 'INCOMPLETE'))
    reasons.add('A connection ended with incomplete reporting');
  if (legacy.length) reasons.add('Legacy connection coverage cannot be reconstructed');
  if (overlap)
    reasons.add('Old and new live estimates may overlap; only the larger subtotal is included');
  if (leaves.length)
    reasons.add('Web call records do not identify every physical provider attempt');
  for (const receipt of receipts) {
    for (const reason of receipt.coverageReasons)
      reasons.add(reason.replace(/_/g, ' ').toLowerCase());
    if (receipt.usageBasis === 'MOCK_ZERO')
      reasons.add('Simulated connection usage is not real provider billing');
    if (!receipt.provenance.pricingVersion || !receipt.provenance.configurationVersion)
      reasons.add('Pricing or configuration version was not recorded');
    if (
      !receipt.provenance.models.length ||
      !receipt.provenance.regions.length ||
      !receipt.provenance.promptVersions.length
    )
      reasons.add('Some model provenance was not recorded');
  }
  return SessionUsageSummarySchema.parse({
    version: 1,
    sessionId,
    recordedSubtotalInr: hasEvidence ? sum(entries.map((row) => row.costInr)).toFixed(4) : null,
    liveConnectionSubtotalInr: receipts.length
      ? sum(receipts.map((row) => row.totals.costInr)).toFixed(4)
      : null,
    webCallSubtotalInr: leaves.length ? sum(leaves.map((row) => row.costInr)).toFixed(4) : null,
    legacySubtotalInr: legacy.length ? sum(legacy.map((row) => row.costInr)).toFixed(4) : null,
    lowerBound: overlap,
    coverage: hasEvidence ? 'PARTIAL' : 'NO_RECORDED_USAGE',
    coverageReasons: [...reasons],
    connections: {
      registered: ownedConnections.length,
      receipted: receipts.length,
      open: ownedConnections.filter((row) => row.state === 'OPEN').length,
      finalReported: ownedConnections.filter((row) => row.state === 'FINAL_REPORTED').length,
      incomplete: ownedConnections.filter((row) => row.state === 'INCOMPLETE').length,
    },
    webCallRecords: leaves.length,
    legacyOverlap: overlap ? 'UNPROVEN' : 'NONE',
    usageBasis: 'RECORDED_ESTIMATE',
    reconciliation: 'NOT_RECONCILED',
  });
}

export interface UsageScope {
  sessionId?: string;
  psychologistId?: string;
  from?: Date;
  to?: Date;
}
/** Windowed connection amounts are allocated by connection start, not exact call timestamps. */
export async function loadRecordedUsage(
  scope: UsageScope,
  db: Pick<
    Prisma.TransactionClient,
    'geminiCallLog' | 'sessionUsageConnection' | '$queryRaw'
  > = prisma,
) {
  const window = {
    ...(scope.from ? { gte: scope.from } : {}),
    ...(scope.to ? { lt: scope.to } : {}),
  };
  const hasWindow = scope.from !== undefined || scope.to !== undefined;
  const calls = await db.geminiCallLog.findMany({
    where: {
      ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
      ...(scope.psychologistId
        ? {
            OR: [
              { session: { psychologistId: scope.psychologistId } },
              { psychologistId: scope.psychologistId },
            ],
          }
        : {}),
      ...(hasWindow ? { createdAt: window } : {}),
      status: { in: METERED_USAGE_STATUSES },
      costInr: { gt: 0 },
    },
    select: {
      sessionId: true,
      pass: true,
      model: true,
      promptVersion: true,
      status: true,
      costInr: true,
      inputTokens: true,
      outputTokens: true,
    },
  });
  const storageAvailable = await hasSessionUsageConnectionStorage(db);
  const connections = storageAvailable
    ? await db.sessionUsageConnection.findMany({
        where: {
          ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
          ...(scope.psychologistId ? { psychologistId: scope.psychologistId } : {}),
          ...(hasWindow ? { startedAt: window } : {}),
        },
        select: {
          connectionId: true,
          sessionId: true,
          psychologistId: true,
          vertical: true,
          backend: true,
          startedAt: true,
          endedAt: true,
          lastPayloadHash: true,
          state: true,
          lastSequence: true,
          lastReceipt: true,
          costInr: true,
        },
      })
    : [];
  return {
    calls,
    connections,
    storageAvailable,
    entries: recordedUsageEntries(calls, connections),
  };
}

export const totalRecordedUsage = (entries: RecordedUsageEntry[]) =>
  sum(entries.map((row) => row.costInr));

export function groupRecordedUsage(
  entries: RecordedUsageEntry[],
  by: 'pass' | 'model' | 'sessionId',
) {
  const groups = new Map<
    string,
    { key: string; costInr: Prisma.Decimal; records: number; tokens: number | null }
  >();
  for (const row of entries) {
    const key = row[by];
    if (!key) continue;
    const group = groups.get(key) ?? { key, costInr: zero(), records: 0, tokens: 0 };
    group.costInr = group.costInr.plus(row.costInr);
    group.records += row.records;
    group.tokens = group.tokens === null || row.tokens === null ? null : group.tokens + row.tokens;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.costInr.comparedTo(a.costInr));
}
