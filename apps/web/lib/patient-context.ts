import { prisma } from './prisma';

/**
 * DOC-3 — the patient's confirmed active medications, pulled from prior
 * encounters, so the drug-interaction engine sees cross-visit risk (e.g. a
 * standing warfarin order + ibuprofen prescribed today) instead of only the
 * drugs drafted in the current consult.
 *
 * Source of truth: CONFIRMED MedicationOrder rows across the client's
 * sessions. DRAFT/DISCARDED orders are excluded (not part of the active
 * regimen), and the current consult can be excluded so its own in-progress
 * draft isn't double-counted. De-duped, newest-confirmed first, bounded.
 */
export async function fetchActiveMedications(
  clientId: string,
  opts?: { excludeSessionId?: string },
): Promise<string[]> {
  const rows = await prisma.medicationOrder.findMany({
    where: {
      status: 'CONFIRMED',
      session: {
        clientId,
        ...(opts?.excludeSessionId ? { id: { not: opts.excludeSessionId } } : {}),
      },
    },
    select: { content: true },
    orderBy: { confirmedAt: 'desc' },
    take: 100,
  });
  const seen = new Set<string>();
  const drugs: string[] = [];
  for (const r of rows) {
    const drug = (r.content as { drug?: unknown })?.drug;
    if (typeof drug !== 'string') continue;
    const trimmed = drug.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    drugs.push(trimmed);
  }
  return drugs;
}

/** Resolve the client for a session (tenant-agnostic; callers gate first). */
export async function clientIdForSession(sessionId: string): Promise<string | null> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { clientId: true },
  });
  return s?.clientId ?? null;
}
