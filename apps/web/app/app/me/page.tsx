import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Container } from '@/components/ui/Container';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint 21 — Therapist-facing "How am I doing?" view.
 *
 * Same per-therapist signal the admin Competency dashboard already
 * computes, but framed for the practitioner: their own counters, no
 * comparison against colleagues, no judgment language. Useful for
 * self-reflection and pilot evaluation.
 */
export default async function MeOverviewPage() {
  const therapist = await requireOnboardedPsychologist();

  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Sprint 48 — fabricated demo rows must not show up in any of the
  // tallies on this page. For Prisma counts we filter via the joined
  // client relation; for audit-log-based counts we exclude the demo
  // client ids in JS after the fetch.
  const demoClientIds = (
    await prisma.client.findMany({
      where: { psychologistId: therapist.id, isDemo: true },
      select: { id: true },
    })
  ).map((c) => c.id);
  const nonDemoClient = { client: { isDemo: false } } as const;

  const [
    activeClients,
    sessions30d,
    sessionsLifetime,
    clinicalReports,
    sectionConfirmations,
    crisisFlags,
    therapyScripts,
    preSessionBriefs,
    patientShares,
    instrumentsAdministered,
    confirmationLatencies,
    episodesClosed,
    progressReports,
  ] = await Promise.all([
    prisma.client.count({
      where: {
        psychologistId: therapist.id,
        status: 'ACTIVE',
        deletedAt: null,
        isDemo: false,
      },
    }),
    prisma.session.count({
      where: {
        psychologistId: therapist.id,
        status: 'COMPLETED',
        endedAt: { gte: since30d },
        ...nonDemoClient,
      },
    }),
    prisma.session.count({
      where: { psychologistId: therapist.id, status: 'COMPLETED', ...nonDemoClient },
    }),
    prisma.clinicalReport.count({
      where: { psychologistId: therapist.id, status: 'COMPLETED', ...nonDemoClient },
    }),
    prisma.auditLog.findMany({
      where: {
        actorPsychologistId: therapist.id,
        action: 'CLINICAL_SECTION_CONFIRMED',
      },
      select: { metadata: true, createdAt: true },
      take: 1000,
    }),
    prisma.auditLog.count({
      where: { actorPsychologistId: therapist.id, action: 'CRISIS_FLAG_RAISED' },
    }),
    prisma.therapyScript.count({ where: { psychologistId: therapist.id, ...nonDemoClient } }),
    prisma.preSessionBrief.count({
      where: { psychologistId: therapist.id, status: 'COMPLETED', ...nonDemoClient },
    }),
    prisma.patientShare.count({ where: { psychologistId: therapist.id, ...nonDemoClient } }),
    prisma.auditLog.count({
      where: {
        actorPsychologistId: therapist.id,
        action: 'INSTRUMENT_ADMINISTERED',
      },
    }),
    prisma.auditLog.findMany({
      where: {
        actorPsychologistId: therapist.id,
        OR: [{ action: 'CLINICAL_REPORT_GENERATED' }, { action: 'CLINICAL_SECTION_CONFIRMED' }],
      },
      select: { action: true, createdAt: true, targetId: true, metadata: true },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    }),
    prisma.auditLog.count({
      where: { actorPsychologistId: therapist.id, action: 'TREATMENT_EPISODE_CLOSED' },
    }),
    prisma.auditLog.count({
      where: { actorPsychologistId: therapist.id, action: 'PATIENT_PROGRESS_REPORT_SHARED' },
    }),
  ]);

  // Audit-log tallies are correct as long as the demo arc never fires
  // these actions. createDemoClient() only writes DEMO_CLIENT_CREATED;
  // it does NOT emit CLINICAL_REPORT_GENERATED, CLINICAL_SECTION_CONFIRMED,
  // INSTRUMENT_ADMINISTERED, CRISIS_FLAG_RAISED, TREATMENT_EPISODE_CLOSED,
  // or PATIENT_PROGRESS_REPORT_SHARED, so no demo rows leak in here.
  void demoClientIds;

  const tally = { accepted: 0, modified: 0, rejected: 0 };
  for (const a of sectionConfirmations) {
    const meta = (a.metadata as { action?: string } | null) ?? null;
    const action = meta?.action ?? 'accept';
    if (action === 'modify') tally.modified++;
    else if (action === 'reject') tally.rejected++;
    else tally.accepted++;
  }
  const totalConfirmations = tally.accepted + tally.modified + tally.rejected;
  const acceptedPct =
    totalConfirmations === 0 ? null : Math.round((tally.accepted * 100) / totalConfirmations);

  const medianMs = computeMedianConfirmationLatencyMs(confirmationLatencies);

  // Sprint 74 — the COGS readout: what the AI actually cost in the last 30
  // days, per pass, from the logged actuals (GeminiCallLog.costInr). This is
  // the ground truth every cost/pricing decision tunes against — estimates
  // live in docs/COST_EFFICIENCY_SPRINTS.md, this number is real.
  const aiUsage = await prisma.geminiCallLog.groupBy({
    by: ['pass'],
    where: {
      createdAt: { gte: since30d },
      session: { is: { psychologistId: therapist.id } },
    },
    _sum: { costInr: true },
    _count: { _all: true },
  });
  const aiTotalInr = aiUsage.reduce((acc, row) => acc + Number(row._sum.costInr ?? 0), 0);
  const aiPerPass = aiUsage
    .map((row) => ({
      pass: row.pass,
      calls: row._count._all,
      costInr: Number(row._sum.costInr ?? 0),
    }))
    .sort((a, b) => b.costInr - a.costInr);
  const aiPerSession = sessions30d > 0 ? aiTotalInr / sessions30d : null;

  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app" className="hover:text-[var(--color-ink)]">
          ← Dashboard
        </Link>
      </p>

      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Your practice
        </p>
        <h1 className="mt-2 font-serif text-3xl">How it's going</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          A quiet readout of your last 30 days and your lifetime totals on the co-pilot. No
          comparisons — this is here to help you notice patterns in your own work.
          {demoClientIds.length > 0 && ' Example-client activity is not counted here.'}
        </p>
      </header>

      {therapist.role === 'ADMIN' && (
        <div className="mb-8 flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--color-line)] bg-white/50 px-5 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            Admin
          </span>
          <Link
            href="/app/admin/invite-codes"
            className="text-sm text-[var(--color-ink-2)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
          >
            Pilot invite codes
          </Link>
          <span className="text-[var(--color-line)]">·</span>
          <Link
            href="/app/admin/erasure-queue"
            className="text-sm text-[var(--color-ink-2)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
          >
            Erasure queue
          </Link>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active clients" value={String(activeClients)} />
        <StatTile label="Sessions · last 30d" value={String(sessions30d)} />
        <StatTile label="Sessions · lifetime" value={String(sessionsLifetime)} />
        <StatTile label="Clinical briefs" value={String(clinicalReports)} />
      </section>

      <section className="mt-8">
        <Card className="p-6">
          <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            AI usage · last 30 days
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            What the AI passes actually cost, from the call log — not an estimate.
          </p>
          {aiPerPass.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-3)]">
              No AI calls logged in the last 30 days.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="text-2xl font-semibold text-[var(--color-ink)]">
                  ₹{aiTotalInr.toFixed(2)}
                </p>
                {aiPerSession !== null && (
                  <p className="text-sm text-[var(--color-ink-2)]">
                    ≈ ₹{aiPerSession.toFixed(2)} per completed session
                  </p>
                )}
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {aiPerPass.map((row) => (
                  <li key={row.pass} className="flex items-baseline justify-between gap-3">
                    <span className="text-[var(--color-ink-2)]">
                      {row.pass.replace(/_/g, ' ').toLowerCase()}
                      <span className="ml-1.5 text-xs text-[var(--color-ink-3)]">
                        × {row.calls}
                      </span>
                    </span>
                    <span className="font-mono text-[var(--color-ink)]">
                      ₹{row.costInr.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            AI suggestion decisions
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Across every Clinical Brief section you have confirmed.
          </p>
          {totalConfirmations === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-3)]">
              No clinical-brief decisions yet. Confirm a section to start the tally.
            </p>
          ) : (
            <dl className="mt-4 grid grid-cols-3 gap-3 text-center">
              <DecisionTile label="Accepted" value={tally.accepted} pct={acceptedPct} primary />
              <DecisionTile
                label="Modified"
                value={tally.modified}
                pct={
                  totalConfirmations === 0
                    ? null
                    : Math.round((tally.modified * 100) / totalConfirmations)
                }
              />
              <DecisionTile
                label="Rejected"
                value={tally.rejected}
                pct={
                  totalConfirmations === 0
                    ? null
                    : Math.round((tally.rejected * 100) / totalConfirmations)
                }
              />
            </dl>
          )}
          <p className="mt-4 text-xs italic text-[var(--color-ink-3)]">
            Modifying or rejecting isn't worse than accepting — the right call depends on the AI
            being right. A balanced split is normal.
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Tempo</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Row label="Median time to confirm a brief" value={formatLatency(medianMs)} />
            <Row label="Crisis flags raised" value={String(crisisFlags)} />
            <Row label="Episodes closed" value={String(episodesClosed)} />
            <Row label="Progress reports shared" value={String(progressReports)} />
          </dl>
        </Card>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Therapy scripts" value={String(therapyScripts)} />
        <StatTile label="Pre-session briefs" value={String(preSessionBriefs)} />
        <StatTile label="Instruments administered" value={String(instrumentsAdministered)} />
        <StatTile label="Patient shares" value={String(patientShares)} />
      </section>
    </Container>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-5">
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <p className="mt-2 font-mono text-3xl tabular-nums text-[var(--color-ink)]">{value}</p>
    </Card>
  );
}

function DecisionTile({
  label,
  value,
  pct,
  primary,
}: {
  label: string;
  value: number;
  pct: number | null;
  primary?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        primary
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]'
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
      {pct !== null && <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{pct}%</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[var(--color-ink-2)]">{label}</dt>
      <dd className="font-mono tabular-nums text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}

function computeMedianConfirmationLatencyMs(
  rows: Array<{
    action: string;
    createdAt: Date;
    targetId: string;
    metadata: unknown;
  }>,
): number | null {
  // Pair each CLINICAL_REPORT_GENERATED with the earliest later
  // CLINICAL_SECTION_CONFIRMED that targets the same report.
  const generated = new Map<string, Date>();
  const latencies: number[] = [];
  for (const r of rows) {
    if (r.action === 'CLINICAL_REPORT_GENERATED') {
      generated.set(r.targetId, r.createdAt);
      continue;
    }
    if (r.action === 'CLINICAL_SECTION_CONFIRMED') {
      const reportId =
        (r.metadata as { clinicalReportId?: string } | null)?.clinicalReportId ?? r.targetId;
      const start = generated.get(reportId);
      if (start) {
        latencies.push(r.createdAt.getTime() - start.getTime());
        generated.delete(reportId);
      }
    }
  }
  if (latencies.length === 0) return null;
  latencies.sort((a, b) => a - b);
  const mid = Math.floor(latencies.length / 2);
  return latencies.length % 2 === 0
    ? Math.round((latencies[mid - 1]! + latencies[mid]!) / 2)
    : latencies[mid]!;
}

function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}
