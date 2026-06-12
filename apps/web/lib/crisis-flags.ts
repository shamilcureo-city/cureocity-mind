import { prisma } from './prisma';

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
}

export async function fetchOpenCrises(clientId: string): Promise<OpenCrisis[]> {
  const reports = await prisma.clinicalReport.findMany({
    where: { clientId, status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { body: true, createdAt: true, confirmations: true },
  });
  const result: OpenCrisis[] = [];
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
  // Dedupe by kind keeping the most recent timestamp.
  const seen = new Map<string, OpenCrisis>();
  for (const c of result) {
    const existing = seen.get(c.kind);
    if (!existing || existing.lastSeenAt < c.lastSeenAt) seen.set(c.kind, c);
  }
  return [...seen.values()].slice(0, 5);
}
