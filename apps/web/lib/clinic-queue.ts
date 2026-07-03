import type { Prisma, SessionStatus } from '@prisma/client';
import type { ClinicQueue, ClinicQueueEntry, ClinicQueueStatus } from '@cureocity/contracts';
import { prisma } from '@/lib/prisma';
import { decryptClientField } from '@/lib/client-pii';

/**
 * Sprint DS7 — helpers for the OPD token queue (the zero-click clinic flow).
 *
 * Tokens are scoped to the *clinic day* in IST (the pilot is Indian OPD);
 * Vercel runs UTC, so an evening consult must not roll the counter at UTC
 * midnight. `istDayRange` returns the UTC instants bounding the IST
 * calendar day, used both to assign the next token and to read the queue.
 */

/** India Standard Time is a fixed UTC+5:30 (no DST). */
const IST_OFFSET_MIN = 5 * 60 + 30;

export interface IstDayRange {
  /** UTC instant at IST 00:00 of the day containing `at`. */
  start: Date;
  /** UTC instant at the next IST 00:00 (exclusive upper bound). */
  end: Date;
  /** The IST calendar date as yyyy-mm-dd. */
  dateKey: string;
}

/** The UTC range bounding the IST calendar day that contains `at`. */
export function istDayRange(at: Date): IstDayRange {
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const start = new Date(Date.UTC(y, m, d) - IST_OFFSET_MIN * 60_000);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start, end, dateKey };
}

/**
 * The next OPD token for this doctor's clinic day — one past the highest
 * token already handed out among their sessions scheduled that IST day.
 * Best-effort under concurrency (two simultaneous walk-ins could tie); a
 * shared token is cosmetic, never a data-integrity problem.
 */
export async function nextClinicToken(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  at: Date,
): Promise<number> {
  const { start, end } = istDayRange(at);
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
 * The doctor's OPD queue for today's IST clinic day — the shared read used
 * by both `GET /api/v1/clinic/queue` and the `/app/clinic` landing page.
 * Ordered by token (tokenless rows last, by time); `nextUp` points at the
 * lowest-token WAITING patient.
 */
export async function loadClinicQueue(psychologistId: string): Promise<ClinicQueue> {
  const { start, end, dateKey } = istDayRange(new Date());
  const rows = await prisma.session.findMany({
    where: { psychologistId, scheduledAt: { gte: start, lt: end } },
    orderBy: [{ tokenNumber: { sort: 'asc', nulls: 'last' } }, { scheduledAt: 'asc' }],
    select: {
      id: true,
      clientId: true,
      tokenNumber: true,
      status: true,
      scheduledAt: true,
      client: {
        select: { fullName: true, fullNameEncrypted: true, dateOfBirth: true, isDemo: true },
      },
    },
  });

  const entries: ClinicQueueEntry[] = await Promise.all(
    rows.map(async (s) => ({
      sessionId: s.id,
      clientId: s.clientId,
      tokenNumber: s.tokenNumber ?? null,
      patientName: await decryptClientField(
        psychologistId,
        s.client.fullNameEncrypted,
        s.client.fullName,
      ),
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
