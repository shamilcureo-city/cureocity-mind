import { Card } from '@/components/ui/Card';
import { requirePageAdmin } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint 17 — Competency dashboard.
 *
 * Per-therapist roll-up of the clinical co-pilot signal: how often
 * AI suggestions are accepted vs modified vs rejected, how fast they
 * confirm sections, crisis surface, etc.
 *
 * Cross-tenant surface (it lists every therapist's stats), so it's
 * gated to the ADMIN role — non-admins bounce to their dashboard.
 */
export default async function CompetencyPage() {
  await requirePageAdmin();
  const psychologists = await prisma.psychologist.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { fullName: 'asc' },
  });

  // Run all per-therapist aggregates in parallel; cap N for the
  // pilot view (10 therapists). For larger orgs we'd switch to a
  // single materialised query.
  const rows = await Promise.all(
    psychologists.slice(0, 50).map(async (p) => {
      const [
        sessions,
        clinicalReports,
        sectionConfirmations,
        crisisFlagAudits,
        therapyScripts,
        preSessionBriefs,
        patientShares,
        confirmationLatencies,
      ] = await Promise.all([
        prisma.session.count({ where: { psychologistId: p.id, status: 'COMPLETED' } }),
        prisma.clinicalReport.count({ where: { psychologistId: p.id, status: 'COMPLETED' } }),
        prisma.auditLog.findMany({
          where: {
            actorPsychologistId: p.id,
            action: 'CLINICAL_SECTION_CONFIRMED',
          },
          select: { metadata: true, createdAt: true },
          take: 500,
        }),
        prisma.auditLog.count({
          where: {
            actorPsychologistId: p.id,
            action: 'CRISIS_FLAG_RAISED',
          },
        }),
        prisma.therapyScript.count({ where: { psychologistId: p.id } }),
        prisma.preSessionBrief.count({
          where: { psychologistId: p.id, status: 'COMPLETED' },
        }),
        prisma.patientShare.count({ where: { psychologistId: p.id } }),
        // Median time-to-confirm: pair PASS_3 GENERATED with the
        // first CLINICAL_SECTION_CONFIRMED per report. Approximate
        // by using audit createdAt deltas.
        prisma.auditLog.findMany({
          where: {
            actorPsychologistId: p.id,
            OR: [{ action: 'CLINICAL_REPORT_GENERATED' }, { action: 'CLINICAL_SECTION_CONFIRMED' }],
          },
          select: { action: true, createdAt: true, targetId: true, metadata: true },
          orderBy: { createdAt: 'asc' },
          take: 1000,
        }),
      ]);

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
        totalConfirmations === 0 ? 0 : Math.round((tally.accepted * 100) / totalConfirmations);
      const modifiedPct =
        totalConfirmations === 0 ? 0 : Math.round((tally.modified * 100) / totalConfirmations);
      const rejectedPct =
        totalConfirmations === 0 ? 0 : Math.round((tally.rejected * 100) / totalConfirmations);

      const medianMs = computeMedianConfirmationLatencyMs(confirmationLatencies);

      return {
        id: p.id,
        fullName: p.fullName,
        email: p.email,
        role: p.role,
        sessions,
        clinicalReports,
        confirmations: tally,
        acceptedPct,
        modifiedPct,
        rejectedPct,
        crisisFlagAudits,
        therapyScripts,
        preSessionBriefs,
        patientShares,
        medianConfirmMs: medianMs,
      };
    }),
  );

  return (
    <>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Admin
        </p>
        <h1 className="mt-2 font-serif text-3xl">Competency dashboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Per-therapist roll-up of clinical co-pilot signal — how often AI suggestions are accepted,
          modified, or rejected, time-to-confirm, crisis surface, and patient-share activity. Useful
          for pilot evaluation; private to clinic owners post-Sprint 9.
        </p>
      </header>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            <tr>
              <th className="px-4 py-3 text-left">Therapist</th>
              <th className="px-3 py-3 text-right">Sessions</th>
              <th className="px-3 py-3 text-right">Briefs</th>
              <th className="px-3 py-3 text-right">Accept %</th>
              <th className="px-3 py-3 text-right">Modify %</th>
              <th className="px-3 py-3 text-right">Reject %</th>
              <th className="px-3 py-3 text-right">Median t-to-confirm</th>
              <th className="px-3 py-3 text-right">Crisis flags</th>
              <th className="px-3 py-3 text-right">Scripts</th>
              <th className="px-3 py-3 text-right">Pre-briefs</th>
              <th className="px-3 py-3 text-right">Shares</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line-soft)]">
            {rows.map((r) => (
              <tr key={r.id} className="text-[var(--color-ink)]">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.fullName}</div>
                  <div className="text-xs text-[var(--color-ink-3)]">{r.email}</div>
                  <div className="text-xs text-[var(--color-ink-3)]">{r.role}</div>
                </td>
                <td className="px-3 py-3 text-right">{r.sessions}</td>
                <td className="px-3 py-3 text-right">{r.clinicalReports}</td>
                <td className="px-3 py-3 text-right">
                  {r.confirmations.accepted ? `${r.acceptedPct}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.confirmations.modified ? `${r.modifiedPct}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right">
                  {r.confirmations.rejected ? `${r.rejectedPct}%` : '—'}
                </td>
                <td className="px-3 py-3 text-right">{formatLatency(r.medianConfirmMs)}</td>
                <td className="px-3 py-3 text-right">{r.crisisFlagAudits}</td>
                <td className="px-3 py-3 text-right">{r.therapyScripts}</td>
                <td className="px-3 py-3 text-right">{r.preSessionBriefs}</td>
                <td className="px-3 py-3 text-right">{r.patientShares}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-[var(--color-ink-3)]">
                  No therapists yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </>
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
        (r.metadata as { clinicalReportId?: string } | null)?.clinicalReportId ??
        // older rows stored the report id as targetId directly
        r.targetId;
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
