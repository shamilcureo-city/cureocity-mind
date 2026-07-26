import { drugNameKey } from '@cureocity/clinical';
import { prisma } from './prisma';

/**
 * Batch B — an ongoing med with no stated duration is still dropped once the
 * record is this old. A chronic prescription is genuinely lifelong, so this is
 * deliberately generous; it exists only so a decade-old row can't resurface as
 * "currently taking".
 */
const ONGOING_MED_MAX_AGE_DAYS = 730;
/** Grace after a finite course ends, for a patient who returns a few days late. */
const COURSE_GRACE_DAYS = 7;
const DAY_MS = 86_400_000;

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
 *
 * Batch B — two fixes:
 *
 *  • EXPIRY. "Active" used to mean "ever confirmed". A 5-day course of
 *    amoxicillin prescribed last March was still being carried forward as a
 *    standing medication a year later — auto-added to every future Rx pad and
 *    fed to the interaction engine as if the patient were still taking it. A
 *    finite course now expires at `confirmedAt + durationDays` (+ a week's
 *    grace); an open-ended med expires only after two years.
 *  • DOSING. Only `drug` was carried, so a continued row reached the pad as a
 *    bare "Metformin" with no strength or frequency. The full dosing rides
 *    along now, which matters more since continued rows are re-authorised
 *    rather than auto-confirmed.
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
    select: { content: true, confirmedAt: true, createdAt: true },
    orderBy: { confirmedAt: 'desc' },
    take: 100,
  });
  const now = Date.now();
  const seen = new Set<string>();
  const drugs: string[] = [];
  for (const r of rows) {
    const content = r.content as {
      drug?: unknown;
      strength?: unknown;
      dose?: unknown;
      frequency?: unknown;
      durationDays?: unknown;
    } | null;
    const drug = content?.drug;
    if (typeof drug !== 'string') continue;
    const trimmed = drug.trim();
    if (!trimmed) continue;

    const startedAt = (r.confirmedAt ?? r.createdAt)?.getTime() ?? null;
    if (startedAt !== null && isExpired(startedAt, content?.durationDays, now)) continue;

    // Key on the drug NAME so two dose variants of the same drug collapse to
    // the newest (rows are newest-confirmed first).
    const key = drugNameKey(trimmed) || trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    drugs.push(withDosing(trimmed, content));
  }
  return drugs;
}

/** True once a med's course has finished (or the record is simply ancient). */
function isExpired(startedAtMs: number, durationDays: unknown, nowMs: number): boolean {
  const ageDays = (nowMs - startedAtMs) / DAY_MS;
  if (typeof durationDays === 'number' && Number.isFinite(durationDays) && durationDays > 0) {
    return ageDays > durationDays + COURSE_GRACE_DAYS;
  }
  return ageDays > ONGOING_MED_MAX_AGE_DAYS;
}

/** "Metformin" + {strength:'500 mg', frequency:'BD'} → "Metformin 500 mg BD". */
function withDosing(
  drug: string,
  content: { strength?: unknown; dose?: unknown; frequency?: unknown } | null,
): string {
  const parts = [drug];
  for (const key of ['strength', 'dose', 'frequency'] as const) {
    const v = content?.[key];
    if (typeof v === 'string' && v.trim()) parts.push(v.trim());
  }
  return parts.join(' ');
}

/**
 * Batch B — the patient's recorded drug allergies, for the live CaseState and
 * the Rx pad's allergy check. An empty array means NOT RECORDED, which the UI
 * must never render as "no known allergies".
 */
export async function fetchAllergies(clientId: string): Promise<string[]> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { allergies: true },
  });
  return (client?.allergies ?? []).map((a) => a.trim()).filter(Boolean);
}

/** Resolve the client for a session (tenant-agnostic; callers gate first). */
export async function clientIdForSession(sessionId: string): Promise<string | null> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { clientId: true },
  });
  return s?.clientId ?? null;
}
