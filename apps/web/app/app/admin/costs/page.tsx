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
} from '@/components/app/admin/AdminUI';
import { prisma } from '@/lib/prisma';
import { computeDayBoundaries, formatIstDateTime } from '@/lib/ist';
import type { GeminiCallStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Admin console — AI cost dashboard. What the models actually cost to run,
 * read straight off the call log (`GeminiCallLog`) plus the doctor
 * live-consult meter (`LiveConsultMetric`). Deterministic aggregates over
 * existing rows — no new schema, no mutations. All amounts in INR; `costInr`
 * is a Prisma Decimal, so every figure is `Number()`-cast before arithmetic.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NON_SUCCESS: GeminiCallStatus[] = ['ERROR', 'TIMEOUT', 'CIRCUIT_OPEN'];

function num(d: unknown): number {
  return d == null ? 0 : Number(d);
}

export default async function AdminCostsPage() {
  const now = new Date();
  const todayStart = computeDayBoundaries(now).startOfToday;
  const d7 = new Date(now.getTime() - 7 * DAY_MS);
  const d30 = new Date(now.getTime() - 30 * DAY_MS);

  const [todayAgg, sevenAgg, thirtyAgg, byPass, byModel, errors7d, topSessions, liveAgg] =
    await Promise.all([
      prisma.geminiCallLog.aggregate({
        _sum: { costInr: true },
        where: { createdAt: { gte: todayStart } },
      }),
      prisma.geminiCallLog.aggregate({
        _sum: { costInr: true },
        where: { createdAt: { gte: d7 } },
      }),
      prisma.geminiCallLog.aggregate({
        _sum: { costInr: true },
        _count: true,
        where: { createdAt: { gte: d30 } },
      }),
      prisma.geminiCallLog.groupBy({
        by: ['pass'],
        _sum: { costInr: true },
        _count: true,
        where: { createdAt: { gte: d30 } },
        orderBy: { _sum: { costInr: 'desc' } },
      }),
      prisma.geminiCallLog.groupBy({
        by: ['model'],
        _sum: { costInr: true, inputTokens: true, outputTokens: true },
        _count: true,
        where: { createdAt: { gte: d30 } },
        orderBy: { _sum: { costInr: 'desc' } },
      }),
      prisma.geminiCallLog.groupBy({
        by: ['status'],
        _count: true,
        where: { createdAt: { gte: d7 }, status: { not: 'SUCCESS' } },
      }),
      prisma.geminiCallLog.groupBy({
        by: ['sessionId'],
        _sum: { costInr: true },
        where: { createdAt: { gte: d30 }, sessionId: { not: null } },
        orderBy: { _sum: { costInr: 'desc' } },
        take: 8,
      }),
      prisma.liveConsultMetric.aggregate({
        _sum: { costInr: true, windows: true },
        _count: true,
        where: { createdAt: { gte: d30 } },
      }),
    ]);

  const spendToday = num(todayAgg._sum.costInr);
  const spend7d = num(sevenAgg._sum.costInr);
  const spend30d = num(thirtyAgg._sum.costInr);
  const calls30d = thirtyAgg._count;

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
        description="What the models actually cost to run, from the Gemini call log plus the doctor live-consult meter. Rolling windows in IST; figures are aggregate across all tenants."
      />

      <StatGrid>
        <StatTile
          label="Spend today"
          value={inr(spendToday)}
          sub="since IST midnight"
          tone="accent"
        />
        <StatTile label="Spend · 7d" value={inr(spend7d)} sub="rolling 7 days" />
        <StatTile label="Spend · 30d" value={inr(spend30d)} sub="rolling 30 days" />
        <StatTile
          label="Calls · 30d"
          value={calls30d.toLocaleString('en-IN')}
          sub={`${errorTotal7d.toLocaleString('en-IN')} non-success · 7d`}
          tone={circuitOpen > 0 ? 'warn' : 'default'}
        />
      </StatGrid>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AdminCard title="Spend by pass · 30d" hint="Gemini call log, grouped by pass">
          <Table>
            <Thead
              cols={[
                { label: 'Pass' },
                { label: 'Calls', align: 'right' },
                { label: 'Cost', align: 'right' },
              ]}
            />
            <tbody>
              {byPass.length === 0 ? (
                <EmptyRow colSpan={3}>No calls in the last 30 days.</EmptyRow>
              ) : (
                byPass.map((r) => (
                  <Tr key={r.pass}>
                    <Td>
                      <span className="font-mono text-xs">{r.pass}</span>
                    </Td>
                    <Td align="right" nums>
                      {r._count.toLocaleString('en-IN')}
                    </Td>
                    <Td align="right" nums>
                      {inr(num(r._sum.costInr))}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard title="Spend by model · 30d" hint="Grouped by model id, with total tokens">
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
                  const tokens = num(r._sum.inputTokens) + num(r._sum.outputTokens);
                  return (
                    <Tr key={r.model}>
                      <Td>
                        <span className="font-mono text-xs">{r.model}</span>
                      </Td>
                      <Td align="right" nums>
                        {tokens.toLocaleString('en-IN')}
                      </Td>
                      <Td align="right" nums>
                        {inr(num(r._sum.costInr))}
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
        <AdminCard title="Costliest sessions · 30d" hint="Top 8 by aggregate call cost">
          <Table>
            <Thead cols={[{ label: 'Session' }, { label: 'Cost', align: 'right' }]} />
            <tbody>
              {topSessions.length === 0 ? (
                <EmptyRow colSpan={2}>No session-attributed calls in the last 30 days.</EmptyRow>
              ) : (
                topSessions.map((r) => (
                  <Tr key={r.sessionId ?? 'null'}>
                    <Td>
                      <span className="font-mono text-xs">{(r.sessionId ?? '').slice(0, 16)}…</span>
                    </Td>
                    <Td align="right" nums>
                      {inr(num(r._sum.costInr))}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            Aggregate figures across every pass logged against the session.
          </p>
        </AdminCard>

        <AdminCard title="Doctor live consults · 30d" hint="From LiveConsultMetric (gateway meter)">
          <div className="space-y-0">
            <DefRow label="Consults metered">{liveConsults30d.toLocaleString('en-IN')}</DefRow>
            <DefRow label="Windows processed">{liveWindows30d.toLocaleString('en-IN')}</DefRow>
            <DefRow label="Live spend">{inr(liveSpend30d)}</DefRow>
          </div>
          <p className="mt-3 text-xs text-[var(--color-ink-3)]">
            The live gateway meters its own token spend separately from the batch call log; this is
            doctor-vertical cost on top of the spend tiles above.
          </p>
        </AdminCard>
      </div>

      <p className="mt-6 text-xs text-[var(--color-ink-3)]">
        As of {formatIstDateTime(now)} IST · read-only, computed at request time.
      </p>
    </>
  );
}
