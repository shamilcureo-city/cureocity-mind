import { prisma } from '@/lib/prisma';
import { requirePageAdmin } from '@/lib/auth-page';
import {
  AdminPageHeader,
  StatGrid,
  StatTile,
  AdminCard,
  Pill,
  Table,
  Thead,
  Tr,
  Td,
  EmptyRow,
  DefRow,
  type PillTone,
} from '@/components/console/AdminUI';
import type { AuditAction, DsrErasureStatus, DsrGrievanceStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

/**
 * Super-admin console — platform-wide DPDP posture.
 *
 * Cross-tenant read-only roll-up of the data-rights machinery: the erasure
 * and grievance queues (with age + SLA flags), 30-day DSR request/fulfilment
 * activity, and the encryption / retention config readout. Deterministic
 * aggregates over existing tables — no new schema, no mutations. Never
 * renders client PHI/PII: only ids, statuses, ages, and counts.
 *
 * Guard + shell (Container, AdminNav) come from the /console layout.
 */

const ERASURE_SLA_DAYS = 30;
const DSR_WINDOW_DAYS = 30;

// Every DSR_* audit action (all start with DSR_). Prisma enum columns can't
// be filtered with startsWith, so we enumerate the set explicitly.
const DSR_ACTIONS = [
  'DSR_ACCESS_REQUESTED',
  'DSR_ACCESS_FULFILLED',
  'DSR_CORRECTION_REQUESTED',
  'DSR_ERASURE_REQUESTED',
  'DSR_ERASURE_FULFILLED',
  'DSR_NOMINATION_RECORDED',
  'DSR_GRIEVANCE_FILED',
  'DSR_CONSENT_WITHDRAWN',
] as const satisfies readonly AuditAction[];

const ERASURE_PILL: Record<DsrErasureStatus, PillTone> = {
  PENDING: 'warn',
  APPROVED: 'accent',
  FULFILLED: 'good',
  REJECTED: 'muted',
};

const GRIEVANCE_PILL: Record<DsrGrievanceStatus, PillTone> = {
  OPEN: 'warn',
  ACKNOWLEDGED: 'accent',
  RESOLVED: 'good',
  CLOSED: 'muted',
};

function ageDays(from: Date, now: number): number {
  return Math.max(0, Math.floor((now - from.getTime()) / 86_400_000));
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

export default async function AdminCompliancePage() {
  await requirePageAdmin();
  const now = Date.now();
  const dsrSince = new Date(now - DSR_WINDOW_DAYS * 86_400_000);
  const audioRetentionDays = process.env.AUDIO_RETENTION_DAYS ?? '30';
  const kmsBackend = process.env.KMS_BACKEND ?? 'local-dev';

  const [
    erasurePending,
    grievancesOpen,
    erasureQueue,
    grievancesActive,
    grievancesClosed,
    dsrGroups,
  ] = await Promise.all([
    prisma.clientErasureRequest.count({ where: { status: 'PENDING' } }),
    prisma.clientGrievance.count({ where: { status: 'OPEN' } }),
    prisma.clientErasureRequest.findMany({
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, status: true, createdAt: true },
    }),
    // OPEN / ACKNOWLEDGED first (oldest first — the ones still owed work).
    prisma.clientGrievance.findMany({
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.clientGrievance.findMany({
      where: { status: { in: ['RESOLVED', 'CLOSED'] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, status: true, createdAt: true },
    }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where: { action: { in: [...DSR_ACTIONS] }, createdAt: { gte: dsrSince } },
      _count: { action: true },
    }),
  ]);

  const dsrCounts = new Map<string, number>(dsrGroups.map((g) => [g.action, g._count.action]));
  const dsrTotal = dsrGroups.reduce((sum, g) => sum + g._count.action, 0);

  const grievances = [...grievancesActive, ...grievancesClosed].slice(0, 20);

  return (
    <>
      <AdminPageHeader
        eyebrow="Admin · compliance"
        title="DPDP posture"
        description="Platform-wide data-rights health: erasure + grievance queues, 30-day DSR activity, and encryption / retention config. Read-only aggregates over existing tables — ids, statuses, and counts only, never client identity."
      />

      <StatGrid>
        <StatTile
          label="Erasure — pending"
          value={String(erasurePending)}
          sub="awaiting review"
          tone={erasurePending > 0 ? 'warn' : 'default'}
        />
        <StatTile
          label="Grievances — open"
          value={String(grievancesOpen)}
          sub="not yet acknowledged"
          tone={grievancesOpen > 0 ? 'warn' : 'default'}
        />
        <StatTile label="DSR actions · 30d" value={String(dsrTotal)} sub="all DSR_* audit rows" />
        <StatTile
          label="Audio retention"
          value={`${audioRetentionDays}d`}
          sub="AUDIO_RETENTION_DAYS"
        />
      </StatGrid>

      <div className="mt-6 space-y-6">
        <AdminCard
          title="Erasure queue"
          hint="Oldest first. PENDING requests older than 30 days breach the DPDP SLA. Fulfilment runs in the therapist-scoped worker at /app/data-rights/erasure-queue."
        >
          <Table>
            <Thead
              cols={[
                { label: 'Request' },
                { label: 'Status' },
                { label: 'Age', align: 'right' },
                { label: 'SLA', align: 'right' },
              ]}
            />
            <tbody>
              {erasureQueue.length === 0 ? (
                <EmptyRow colSpan={4}>No erasure requests.</EmptyRow>
              ) : (
                erasureQueue.map((r) => {
                  const age = ageDays(r.createdAt, now);
                  const overdue = r.status === 'PENDING' && age > ERASURE_SLA_DAYS;
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <span className="font-mono text-xs text-[var(--color-ink-2)]">
                          {shortId(r.id)}
                        </span>
                      </Td>
                      <Td>
                        <Pill tone={ERASURE_PILL[r.status]}>{r.status}</Pill>
                      </Td>
                      <Td align="right" nums muted>
                        {age}d
                      </Td>
                      <Td align="right">
                        {overdue ? (
                          <Pill tone="danger">overdue</Pill>
                        ) : (
                          <span className="text-[var(--color-ink-3)]">—</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard
          title="Grievances"
          hint="Open + acknowledged first (oldest first), then most-recent resolved / closed."
        >
          <Table>
            <Thead
              cols={[{ label: 'Grievance' }, { label: 'Status' }, { label: 'Age', align: 'right' }]}
            />
            <tbody>
              {grievances.length === 0 ? (
                <EmptyRow colSpan={3}>No grievances filed.</EmptyRow>
              ) : (
                grievances.map((g) => (
                  <Tr key={g.id}>
                    <Td>
                      <span className="font-mono text-xs text-[var(--color-ink-2)]">
                        {shortId(g.id)}
                      </span>
                    </Td>
                    <Td>
                      <Pill tone={GRIEVANCE_PILL[g.status]}>{g.status}</Pill>
                    </Td>
                    <Td align="right" nums muted>
                      {ageDays(g.createdAt, now)}d
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </AdminCard>

        <AdminCard
          title="DSR activity · last 30 days"
          hint="Count of each data-subject-request audit action written in the trailing 30-day window."
        >
          {DSR_ACTIONS.map((action) => (
            <DefRow key={action} label={action}>
              {dsrCounts.get(action) ?? 0}
            </DefRow>
          ))}
        </AdminCard>

        <AdminCard
          title="Encryption & retention"
          hint="PII is envelope-encrypted (KMS-backed); audio purges on the retention cron. System config detail lives at /console/system."
        >
          <DefRow label="KMS backend">
            <span className="font-mono text-xs">{kmsBackend}</span>
          </DefRow>
          <DefRow label="Audio retention">{audioRetentionDays} days</DefRow>
          <DefRow label="PII backfill">
            <span className="font-mono text-xs text-[var(--color-ink-3)]">
              POST /api/v1/admin/encryption/backfill
            </span>
          </DefRow>
        </AdminCard>
      </div>
    </>
  );
}
