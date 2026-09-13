import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  Pill,
  PresenceBadge,
  Table,
  Thead,
  Tr,
  Td,
  EmptyRow,
  DefRow,
  inr,
} from '@/components/console/AdminUI';
import { prisma } from '@/lib/prisma';
import { computeDayBoundaries, formatIstDateTime } from '@/lib/ist';
import { requirePageAdmin } from '@/lib/auth-page';
import type { GeminiCallStatus } from '@prisma/client';
import { groupRecordedUsage, loadRecordedUsage, totalRecordedUsage } from '@/lib/session-usage';

export const dynamic = 'force-dynamic';

/**
 * Operational estimates, not reconciled provider invoices. Positive failed calls
 * count; exact legacy mirrors and connection receipts use shared precedence.
 * LiveConsultMetric below is latency telemetry, never another cost addend.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NON_SUCCESS: GeminiCallStatus[] = ['ERROR', 'TIMEOUT', 'CIRCUIT_OPEN'];

function num(d: unknown): number {
  return d == null ? 0 : Number(d);
}

export default async function AdminCostsPage() {
  await requirePageAdmin();
  const now = new Date();
  const todayStart = computeDayBoundaries(now).startOfToday;
  const d7 = new Date(now.getTime() - 7 * DAY_MS);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);

  const [todayUsage, sevenUsage, thirtyUsage, errors7d, liveAgg] = await Promise.all([
    loadRecordedUsage({ from: todayStart }),
    loadRecordedUsage({ from: d7 }),
    loadRecordedUsage({ from: d30 }),
    prisma.geminiCallLog.groupBy({
      by: ['status'],
      _count: true,
      where: { createdAt: { gte: d7 }, status: { not: 'SUCCESS' } },
    }),
    prisma.liveConsultMetric.aggregate({
      _sum: { costInr: true, windows: true },
      _count: true,
      where: { createdAt: { gte: d30 } },
    }),
  ]);

  const spendToday = totalRecordedUsage(todayUsage.entries).toNumber();
  const spend7d = totalRecordedUsage(sevenUsage.entries).toNumber();
  const spend30d = totalRecordedUsage(thirtyUsage.entries).toNumber();
  const byPass = groupRecordedUsage(thirtyUsage.entries, 'pass');
  const byModel = groupRecordedUsage(thirtyUsage.entries, 'model');
  const topSessions = groupRecordedUsage(thirtyUsage.entries, 'sessionId').slice(0, 8);
  const calls30d = thirtyUsage.calls.length;
  const overlaps = thirtyUsage.entries.filter((row) => row.overlap).length;

  const errorByStatus = new Map<GeminiCallStatus, number>();
  for (const r of errors7d) errorByStatus.set(r.status, r._count);
  const circuitOpen = errorByStatus.get('CIRCUIT_OPEN') ?? 0;
  const errorTotal7d = NON_SUCCESS.reduce((s, k) => s + (errorByStatus.get(k) ?? 0), 0);

  const liveSpend30d = num(liveAgg._sum.costInr);
  const liveConsults30d = liveAgg._count;
  const liveWindows30d = num(liveAgg._sum.windows);

  const sessionCap = Number(process.env['COST_CAP_PER_SESSION_INR'] ?? 500);
  const monthlyCap = Number(process.env['COST_CAP_PER_THERAPIST_MONTHLY_INR'] ?? 15_000);

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin console"
        title="AI costs"
        description="Recorded AI processing estimates across all tenants, not provider invoices. Connection amounts are allocated by their start time; web calls by their logged time. Missing records, retries, hosting and taxes are not reconstructed."
      />

      <StatGrid>
        <StatTile
          label="Recorded estimate today"
          value={inr(spendToday)}
          sub="since IST midnight"
          tone="accent"
        />
        <StatTile
          label="Recorded estimate · 7d"
          value={inr(spend7d)}
          sub="rolling 7 days, partial"
        />
        <StatTile
          label="Recorded estimate · 30d"
          value={inr(spend30d)}
          sub="rolling 30 days, partial"
        />
        <StatTile
          label="Positive call-log records · 30d"
          value={calls30d.toLocaleString('en-IN')}
          sub={`${errorTotal7d.toLocaleString('en-IN')} non-success · 7d`}
          tone={circuitOpen > 0 ? 'warn' : 'default'}
        />
      </StatGrid>
      <p className="mt-4 text-sm text-[var(--color-ink-2)]">
        {overlaps > 0
          ? `${overlaps} sessions have unresolved old/new live overlap. These amounts are lower bounds: only the larger live subtotal is included.`
          : 'No old/new live overlap was found in this window. Coverage remains partial and unreconciled.'}{' '}
        Connection subtotals are grouped separately because a connection can use several models and
        passes.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard
          title="Estimate by source · 30d"
          hint="Web passes and non-additive live subtotal groups"
        >
          <Table>
            <Thead
              cols={[
                { label: 'Pass' },
                { label: 'Records', align: 'right' },
                { label: 'Cost', align: 'right' },
              ]}
            />
            <tbody>
              {byPass.length === 0 ? (
                <EmptyRow colSpan={3}>No calls in the last 30 days.</EmptyRow>
              ) : (
                byPass.map((r) => (
                  <Tr key={r.key}>
                    <Td>
                      <span className="font-mono text-xs">{r.key}</span>
                    </Td>
                    <Td align="right" nums>
                      {r.records.toLocaleString('en-IN')}
                    </Td>
                    <Td align="right" nums>
                      {inr(r.costInr.toNumber())}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard
          title="Estimate by model/source · 30d"
          hint="Tokens shown for web leaves only; live sources may use multiple models"
        >
          <Table>
            <Thead
              cols={[
                { label: 'Model' },
                { label: 'Tokens', align: 'right' },
                { label: 'Cost', align: 'right' },
              ]}
            />
            <tbody>
              {byModel.length === 0 ? (
                <EmptyRow colSpan={3}>No calls in the last 30 days.</EmptyRow>
              ) : (
                byModel.map((r) => {
                  const tokens = r.tokens;
                  return (
                    <Tr key={r.key}>
                      <Td>
                        <span className="font-mono text-xs">{r.key}</span>
                      </Td>
                      <Td align="right" nums>
                        {tokens === null ? 'Not allocated' : tokens.toLocaleString('en-IN')}
                      </Td>
                      <Td align="right" nums>
                        {inr(r.costInr.toNumber())}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard title="Errors · 7d" hint="Non-success Gemini calls by status">
          <div className="space-y-0">
            {NON_SUCCESS.map((status) => (
              <DefRow key={status} label={status}>
                {(errorByStatus.get(status) ?? 0).toLocaleString('en-IN')}
              </DefRow>
            ))}
          </div>
          {circuitOpen > 0 ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-[var(--color-ink-3)]">
              <Pill tone="warn">circuit open</Pill>
              {circuitOpen.toLocaleString('en-IN')} cost-circuit trip
              {circuitOpen === 1 ? '' : 's'} in the last 7 days — the guard shed calls to cap spend.
            </p>
          ) : (
            <p className="mt-3 text-xs text-[var(--color-ink-3)]">
              No cost-circuit trips in the last 7 days.
            </p>
          )}
        </AdminCard>

        <AdminCard title="Cost guardrails" hint="Env-configured caps enforced by lib/cost-guard.ts">
          <div className="space-y-0">
            <DefRow label="Per-session cap">{inr(sessionCap)}</DefRow>
            <DefRow label="Per-therapist monthly cap">{inr(monthlyCap)}</DefRow>
            <DefRow label="Enforcement">
              <PresenceBadge set okText="enforced" />
            </DefRow>
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            When a session or a therapist&rsquo;s monthly total crosses its cap, the cost circuit
            opens and further calls are shed (logged as CIRCUIT_OPEN above).
          </p>
        </AdminCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard
          title="Largest recorded session estimates · 30d"
          hint="Top 8 partial estimates with non-additive live precedence"
        >
          <Table>
            <Thead cols={[{ label: 'Session' }, { label: 'Cost', align: 'right' }]} />
            <tbody>
              {topSessions.length === 0 ? (
                <EmptyRow colSpan={2}>No session-attributed calls in the last 30 days.</EmptyRow>
              ) : (
                topSessions.map((r) => (
                  <Tr key={r.key}>
                    <Td>
                      <span className="font-mono text-xs">{r.key.slice(0, 16)}…</span>
                    </Td>
                    <Td align="right" nums>
                      {inr(r.costInr.toNumber())}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            Positive recorded costs, including rejected output. Missing usage is not zero.
          </p>
        </AdminCard>

        <AdminCard
          title="Legacy live telemetry · 30d"
          hint="Both verticals; the first saved connection sample per session"
        >
          <div className="space-y-0">
            <DefRow label="Consults metered">{liveConsults30d.toLocaleString('en-IN')}</DefRow>
            <DefRow label="Windows processed">{liveWindows30d.toLocaleString('en-IN')}</DefRow>
            <DefRow label="Legacy sample estimate">{inr(liveSpend30d)}</DefRow>
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            This telemetry is not an additional cost. Its positive legacy mirror is already
            considered in the estimates above. It does not cover every reconnect.
          </p>
        </AdminCard>
      </div>

      <p className="mt-6 text-xs text-[var(--color-ink-3)]">
        As of {formatIstDateTime(now)} IST · read-only, computed at request time.
      </p>
    </>
  );
}
