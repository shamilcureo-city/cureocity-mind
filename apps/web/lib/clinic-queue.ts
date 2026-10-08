import type { Prisma, SessionStatus } from '@prisma/client';
import type { ClinicQueue, ClinicQueueEntry, ClinicQueueStatus } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { decryptClientField } from '@/lib/client-pii';
import { ReceptionTimezoneSchema, type ReceptionTimezone } from './reception';

/**
 * Sprint DS7 — helpers for the OPD token queue (the zero-click clinic flow).
 *
 * Tokens are scoped to the configured clinic day, not the server's UTC
 * day. Existing India configuration is preserved; unconfigured Scribe
 * clinics default to Dubai while Mind retains its Indian clinic day.
 */

/** India Standard Time is a fixed UTC+5:30 (no DST). */
const IST_OFFSET_MIN = 5 * 60 + 30;

export interface IstDayRange {
  /** UTC instant at local 00:00 of the day containing `at`. */
  start: Date;
  /** UTC instant at the next local 00:00 (exclusive upper bound). */
  end: Date;
  /** The local calendar date as yyyy-mm-dd. */
  dateKey: string;
}

/** The UTC range bounding the IST calendar day that contains `at`. */
export function istDayRange(at: Date): IstDayRange {
  return clinicDayRange(at, 'Asia/Kolkata');
}

export function clinicDayRange(at: Date, timezone: ReceptionTimezone): IstDayRange {
  const offset = timezone === 'Asia/Dubai' ? 4 * 60 : IST_OFFSET_MIN;
  const ist = new Date(at.getTime() + offset * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - offset * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start, end, dateKey };
}

/** Practice configuration wins even when reception is disabled. Without a
 * configured zone, Scribe uses Dubai and Mind retains its Indian clinic day.
 * Probe optional storage before selecting from it (no migration on this path).
 */
export async function clinicTimezone(
  psychologistId: string,
  db: Pick<Prisma.TransactionClient, 'receptionSettings' | 'psychologist' | '$queryRaw'> = prisma,
): Promise<ReceptionTimezone> {
  const practitioner = await db.psychologist.findUnique({
    where: { id: psychologistId },
    select: { vertical: true },
  });
  const fallback = practitioner?.vertical === 'DOCTOR' ? 'Asia/Dubai' : 'Asia/Kolkata';
  const storage = await db.$queryRaw<
    Array<{ exists: boolean }>
  >`SELECT to_regclass('public.reception_settings') IS NOT NULL AS "exists"`;
  if (storage.length !== 1 || typeof storage[0]?.exists !== 'boolean')
    throw new Error('Clinic timezone storage could not be verified');
  if (!storage[0].exists) return fallback;
  const row = await db.receptionSettings.findUnique({
    where: { psychologistId },
    select: { config: true },
  });
  const config = row?.config;
  const zone = ReceptionTimezoneSchema.safeParse(
    config && typeof config === 'object' && !Array.isArray(config) ? config.timezone : null,
  );
  return zone.success ? zone.data : fallback;
}

/**
 * The next OPD token for this doctor's clinic day — one past the highest
 * token already handed out among their sessions scheduled that clinic day.
 * Best-effort under concurrency (two simultaneous walk-ins could tie); a
 * shared token is cosmetic, never a data-integrity problem.
 */
export async function nextClinicToken(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  at: Date,
): Promise<number> {
  const { start, end } = clinicDayRange(at, await clinicTimezone(psychologistId, tx));
  const agg = await tx.session.aggregate({
    where: {
      psychologistId,
      scheduledAt: { gte: start, lt: end },
      tokenNumber: { not: null },
    },
    _max: { tokenNumber: true },
  });
  return (agg._max.tokenNumber ?? 0) + 1;
}

/** Map the session lifecycle onto the queue's four visible states. */
export function deriveQueueStatus(status: SessionStatus): ClinicQueueStatus {
  switch (status) {
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'COMPLETED':
      return 'DONE';
    case 'CANCELLED':
    case 'NO_SHOW':
    case 'RESCHEDULED':
      return 'CANCELLED';
    default:
      return 'WAITING';
  }
}

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/**
 * The doctor's OPD queue for today's configured clinic day — the shared read used
 * by both `GET /api/v1/clinic/queue` and the `/app/clinic` landing page.
 * Ordered by token (tokenless rows last, by time); `nextUp` points at the
 * lowest-token WAITING patient.
 */
export async function loadClinicQueue(psychologistId: string): Promise<ClinicQueue> {
  const { start, end, dateKey } = clinicDayRange(new Date(), await clinicTimezone(psychologistId));
  const rows = await prisma.session.findMany({
    // Archived clients (deletedAt set) drop out of the OPD queue.
    where: { psychologistId, scheduledAt: { gte: start, lt: end }, client: { deletedAt: null } },
    orderBy: [{ tokenNumber: { sort: 'asc', nulls: 'last' } }, { scheduledAt: 'asc' }],
    select: {
      id: true,
      clientId: true,
      tokenNumber: true,
      status: true,
      scheduledAt: true,
      client: {
        select: { fullNameEncrypted: true, dateOfBirth: true, isDemo: true },
      },
    },
  });

  const entries: ClinicQueueEntry[] = await Promise.all(
    rows.map(async (s) => ({
      sessionId: s.id,
      clientId: s.clientId,
      tokenNumber: s.tokenNumber ?? null,
      patientName: await decryptClientField(psychologistId, s.client.fullNameEncrypted),
      age: ageFrom(s.client.dateOfBirth),
      status: deriveQueueStatus(s.status),
      scheduledAt: s.scheduledAt.toISOString(),
      isDemo: s.client.isDemo,
    })),
  );

  const nextUp = entries.find((e) => e.status === 'WAITING') ?? null;
  const waitingCount = entries.filter((e) => e.status === 'WAITING').length;
  const doneCount = entries.filter((e) => e.status === 'DONE').length;
  return { date: dateKey, entries, nextUp, waitingCount, doneCount };
}
