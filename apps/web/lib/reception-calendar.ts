import type { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { ReceptionSettingsSchema, type ReceptionBusyInterval } from './reception';

export class ReceptionCalendarConflictError extends Error {
  readonly code = 'RECEPTION_CALENDAR_CONFLICT' as const;

  constructor(message = 'That time is no longer available. Choose another appointment time.') {
    super(message);
    this.name = 'ReceptionCalendarConflictError';
  }
}

/** Always take this before Client, Appointment, Session, or queue-token locks. */
export async function acquireReceptionCalendarLock(
  tx: Prisma.TransactionClient,
  psychologistId: string,
): Promise<void> {
  const key = `reception-calendar:${psychologistId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/**
 * The deployment switch is checked before any database access, so the existing
 * routes work without the pilot tables when it is off. Lock before the settings
 * read to serialize opt-in changes with bookings as well as other calendar writes.
 */
export async function lockReceptionCalendarIfEnabled(
  tx: Prisma.TransactionClient,
  psychologistId: string,
): Promise<{ slotMinutes: number } | null> {
  if (process.env.RECEPTION_PILOT_ENABLED !== 'true') return null;
  await acquireReceptionCalendarLock(tx, psychologistId);
  const row = await tx.receptionSettings.findUnique({ where: { psychologistId } });
  if (!row?.enabled) return null;
  const parsed = ReceptionSettingsSchema.safeParse({
    ...(row.config && typeof row.config === 'object' && !Array.isArray(row.config)
      ? row.config
      : {}),
    version: row.revision,
    enabled: row.enabled,
    slug: row.slug,
  });
  if (!parsed.success) {
    throw new ReceptionCalendarConflictError('Reception settings need review before scheduling.');
  }
  return { slotMinutes: parsed.data.slotMinutes };
}

/** Standalone sessions have no duration column; reserve at least one hour. */
export function receptionSessionDurationMinutes(slotMinutes: number): number {
  return Number.isFinite(slotMinutes) ? Math.max(60, slotMinutes) : 60;
}

interface ReceptionCalendarQuery {
  from: Date;
  to: Date;
  slotMinutes: number;
  excludeAppointmentId?: string;
  excludeSessionId?: string;
  /** Immediate doctor OPD entries may overlap other queue sessions by design. */
  appointmentsOnly?: boolean;
}

/**
 * Read through the caller's transaction after its calendar lock. Appointment
 * holds and both scheduled/in-progress sessions block reception. Read linked
 * appointment durations too, including long bookings that began before `from`.
 * No clinical fields are fetched.
 */
export async function loadReceptionBusyIntervals(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  input: ReceptionCalendarQuery,
): Promise<ReceptionBusyInterval[]> {
  const sessions = input.appointmentsOnly
    ? []
    : await tx.session.findMany({
        where: {
          psychologistId,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          scheduledAt: { lt: input.to },
          ...(input.excludeSessionId && { id: { not: input.excludeSessionId } }),
        },
        select: { id: true, scheduledAt: true },
      });
  const appointments = await tx.appointment.findMany({
    where: {
      psychologistId,
      OR: [
        {
          status: { in: ['REQUESTED', 'CONFIRMED'] },
          startAt: { lt: input.to },
          endAt: { gt: input.from },
        },
        ...(sessions.length ? [{ sessionId: { in: sessions.map((s) => s.id) } }] : []),
      ],
    },
    select: { id: true, sessionId: true, status: true, startAt: true, endAt: true },
  });
  const linkedAppointments = new Map(
    appointments.filter((a) => a.sessionId).map((a) => [a.sessionId, a]),
  );
  const excludedSessionIds = new Set(
    appointments
      .filter((a) => a.id === input.excludeAppointmentId && a.sessionId)
      .map((a) => a.sessionId),
  );
  const overlaps = (interval: ReceptionBusyInterval) =>
    interval.startAt < input.to && interval.endAt > input.from;
  const busy: ReceptionBusyInterval[] = appointments
    .filter(
      (a) =>
        (a.status === 'REQUESTED' || a.status === 'CONFIRMED') &&
        a.id !== input.excludeAppointmentId &&
        (!input.excludeSessionId || a.sessionId !== input.excludeSessionId) &&
        overlaps(a),
    )
    .map((a) => ({ startAt: a.startAt, endAt: a.endAt }));
  const durationMs = receptionSessionDurationMinutes(input.slotMinutes) * 60_000;
  for (const session of sessions) {
    if (excludedSessionIds.has(session.id)) continue;
    const linked = linkedAppointments.get(session.id);
    const interval = {
      startAt: session.scheduledAt,
      endAt:
        linked && linked.endAt > session.scheduledAt
          ? linked.endAt
          : new Date(session.scheduledAt.getTime() + durationMs),
    };
    if (overlaps(interval)) busy.push(interval);
  }
  return busy;
}

export async function assertReceptionCalendarAvailable(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  input: ReceptionCalendarQuery,
): Promise<void> {
  if ((await loadReceptionBusyIntervals(tx, psychologistId, input)).length > 0) {
    throw new ReceptionCalendarConflictError();
  }
}

export function receptionCalendarConflictResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ReceptionCalendarConflictError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
}
