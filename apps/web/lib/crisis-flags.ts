import { prisma } from './prisma';
import { fetchClinicianDocumentedRisk } from './clinician-documented-risk';

/**
 * Sprint 50 — shared "open crisis flag" reader.
 *
 * Previously a private helper inside
 * `apps/web/app/api/v1/clients/[id]/pre-session-brief/route.ts`. The
 * Prepare panel on the Today screen needs the same view — surface any
 * high/critical crisis flag raised in a prior session so the therapist
 * sees it the moment they expand the card, not buried inside the
 * Pass-5 brief.
 *
 * Walks the most recent five ClinicalReports for the client, picks any
 * high/critical entry from `body.crisisFlags`, dedupes by `kind`
 * keeping the most recent timestamp, and caps the result at five so
 * the UI list stays bounded.
 *
 * No tenant check inside — every caller has already gated by
 * (clientId, psychologistId).
 */
export interface OpenCrisis {
  kind: string;
  severity: 'high' | 'critical';
  lastSeenAt: string;
  source?: 'CLINICIAN_NOTE' | 'CLINICIAN_NOTE_DRAFT';
  sourceSessionId?: string;
}

export async function fetchOpenCrises(clientId: string): Promise<OpenCrisis[]> {
  const reports = await prisma.clinicalReport.findMany({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { body: true, createdAt: true, confirmations: true },
  });
  const result: OpenCrisis[] = [];
  const clinicianRisk = await fetchClinicianDocumentedRisk(clientId);
  if (clinicianRisk)
    result.push({
      kind:
        clinicianRisk.sourceStatus === 'UNFINISHED'
          ? 'clinician_draft_documented_risk'
          : 'clinician_documented_risk',
      severity: clinicianRisk.severity,
      lastSeenAt: clinicianRisk.recordedAt,
      source:
        clinicianRisk.sourceStatus === 'UNFINISHED' ? 'CLINICIAN_NOTE_DRAFT' : 'CLINICIAN_NOTE',
      sourceSessionId: clinicianRisk.sourceSessionId,
    });
  for (const r of reports) {
    if (!r.body) continue;
    const body = r.body as unknown as {
      crisisFlags?: { kind: string; severity: string }[];
    };
    const flags = body.crisisFlags ?? [];
    for (const f of flags) {
      if (f.severity === 'high' || f.severity === 'critical') {
        result.push({
          kind: f.kind,
          severity: f.severity,
          lastSeenAt: r.createdAt.toISOString(),
        });
      }
    }
  }
  // CLIN-1 — a self-check-in or clinician-administered questionnaire endorsing
  // suicidality (PHQ-9 item 9)
  // that the therapist hasn't yet had a session to address is an OPEN
  // crisis. Surface any riskFlagged instrument response taken
  // AFTER the client's most recent completed session so it lands in the
  // same Prepare panel + pre-session brief the therapist reads before the
  // next visit — not buried in a trend. A row already discussed in a
  // session ages out naturally (it predates the newest session).
  const lastSession = await prisma.session.findFirst({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { scheduledAt: 'desc' },
    select: { scheduledAt: true, endedAt: true },
  });
  const since = lastSession?.endedAt ?? lastSession?.scheduledAt ?? new Date(0);
  const riskResponses = await prisma.instrumentResponse.findMany({
    where: {
      clientId,
      riskFlagged: true,
      administeredAt: { gt: since },
    },
    orderBy: { administeredAt: 'desc' },
    take: 5,
    select: { administeredAt: true, administrationMode: true },
  });
  for (const r of riskResponses) {
    result.push({
      kind:
        r.administrationMode === 'CLINICIAN'
          ? 'clinician_administered_suicidality'
          : 'self_reported_suicidality',
      severity: 'critical',
      lastSeenAt: r.administeredAt.toISOString(),
    });
  }

  // Dedupe by kind keeping the most recent timestamp.
  const seen = new Map<string, OpenCrisis>();
  for (const c of result) {
    const existing = seen.get(c.kind);
    if (!existing || existing.lastSeenAt < c.lastSeenAt) seen.set(c.kind, c);
  }
  return [...seen.values()]
    .sort((a, b) => (b.severity === 'critical' ? 1 : 0) - (a.severity === 'critical' ? 1 : 0))
    .slice(0, 5);
}
