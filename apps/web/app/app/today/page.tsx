import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { TodaySessionCard } from '@/components/app/TodaySessionCard';
import { ScheduleSessionPanel } from '@/components/app/ScheduleSessionPanel';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sprint 45 — Today screen.
 *
 * The first app the therapist opens each morning. Shows today's
 * sessions grouped by altitude (now & upcoming → done today →
 * no-shows), plus a Looking Ahead strip with the next three days,
 * plus a Schedule panel to book a new slot in one form.
 *
 * Data is composed from the existing `sessions` table — no new
 * booking entity. `scheduledAt` is what makes a session "today",
 * with the day boundary computed in IST since Cureocity is an
 * India-only product; Vercel's UTC server clock would otherwise
 * cut the day at the wrong moment for an Indian therapist.
 */
export default async function TodayPage() {
  const therapist = await requireOnboardedPsychologist();

  const { startOfToday, endOfToday, startOfTomorrow, lookAheadEnd } = computeDayBoundaries();

  const [todayRows, upcomingRows, clients] = await Promise.all([
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        scheduledAt: { gte: startOfToday, lt: endOfToday },
      },
      orderBy: { scheduledAt: 'asc' },
      select: sessionSelect,
    }),
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        status: 'SCHEDULED',
        scheduledAt: { gte: startOfTomorrow, lt: lookAheadEnd },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 8,
      select: sessionSelect,
    }),
    prisma.client.findMany({
      where: { psychologistId: therapist.id, deletedAt: null, status: 'ACTIVE' },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, preferredModality: true },
    }),
  ]);

  const nowAndUpcoming = todayRows.filter(
    (s) => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS',
  );
  const doneToday = todayRows.filter((s) => s.status === 'COMPLETED');
  const otherToday = todayRows.filter(
    (s) =>
      s.status === 'NO_SHOW' || s.status === 'CANCELLED' || s.status === 'RESCHEDULED',
  );

  return (
    <Container className="py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Today
          </p>
          <h1 className="mt-1 font-serif text-3xl">{formatDayHeader(startOfToday)}</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {summary(nowAndUpcoming.length, doneToday.length)}
          </p>
        </div>
        <ScheduleSessionPanel clients={clients} />
      </header>

      <section className="mt-6">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Now &amp; upcoming
        </h2>
        {nowAndUpcoming.length === 0 ? (
          <Card className="p-8 text-center text-sm text-[var(--color-ink-2)]">
            {todayRows.length === 0
              ? 'Nothing scheduled today. Use Schedule session to book one in, or jump straight to Record for a walk-in.'
              : 'No more sessions scheduled today. See below for what you’ve already done.'}
          </Card>
        ) : (
          <ul className="space-y-3">
            {nowAndUpcoming.map((s) => (
              <li key={s.id}>
                <TodaySessionCard session={toCardProps(s)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {doneToday.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            Done today
          </h2>
          <ul className="space-y-3">
            {doneToday.map((s) => (
              <li key={s.id}>
                <TodaySessionCard session={toCardProps(s)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {otherToday.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
            No-shows &amp; cancellations
          </h2>
          <ul className="space-y-3">
            {otherToday.map((s) => (
              <li key={s.id}>
                <TodaySessionCard session={toCardProps(s)} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Looking ahead — next 3 days
        </h2>
        {upcomingRows.length === 0 ? (
          <Card className="p-6 text-sm text-[var(--color-ink-3)]">
            Nothing on the books yet.{' '}
            <Link href="/app/clients" className="text-[var(--color-accent)] hover:underline">
              Open a client
            </Link>{' '}
            to schedule a follow-up.
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-[var(--color-line-soft)]">
              {upcomingRows.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/app/sessions/${s.id}`}
                    className="grid grid-cols-[1fr_1.2fr_1fr_auto] items-baseline gap-3 px-5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-soft)]"
                  >
                    <span className="font-medium text-[var(--color-ink)]">
                      {formatDayShort(s.scheduledAt)}
                    </span>
                    <span className="text-[var(--color-ink-2)]">{s.client.fullName}</span>
                    <span className="text-xs text-[var(--color-ink-3)]">{s.modality ?? '—'}</span>
                    <span className="text-xs text-[var(--color-ink-3)]">
                      {formatTime(s.scheduledAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Query shape + DTO mapper.
// ---------------------------------------------------------------------------

const sessionSelect = {
  id: true,
  status: true,
  scheduledAt: true,
  modality: true,
  kind: true,
  clientId: true,
  client: { select: { id: true, fullName: true, isDemo: true } },
  noteDraft: { select: { status: true } },
  therapyNote: { select: { id: true } },
} as const;

function toCardProps(row: {
  id: string;
  status: string;
  scheduledAt: Date;
  modality: string | null;
  kind: string;
  clientId: string;
  client: { fullName: string; isDemo: boolean };
  noteDraft: { status: string } | null;
  therapyNote: { id: string } | null;
}) {
  return {
    id: row.id,
    status: row.status as
      | 'SCHEDULED'
      | 'IN_PROGRESS'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'NO_SHOW'
      | 'RESCHEDULED',
    scheduledAt: row.scheduledAt.toISOString(),
    modality: row.modality,
    kind: row.kind as 'INTAKE' | 'TREATMENT' | 'REVIEW',
    clientId: row.clientId,
    clientName: row.client.fullName,
    clientIsDemo: row.client.isDemo,
    hasSignedNote: row.therapyNote !== null,
    draftStatus: row.noteDraft?.status ?? null,
  };
}

// ---------------------------------------------------------------------------
// Day-boundary + formatting helpers (IST).
// ---------------------------------------------------------------------------

/**
 * IST is UTC+5:30 with no DST. Compute today's start/end in IST as
 * UTC Date instances so a Prisma `gte`/`lt` filter behaves correctly
 * regardless of the server's local timezone (Vercel = UTC).
 */
const IST_OFFSET_MIN = 5 * 60 + 30;

function computeDayBoundaries() {
  const now = new Date();
  // What day is it in IST right now? Shift by IST offset, then read
  // the calendar parts; reshift back to UTC for the boundaries.
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const istY = ist.getUTCFullYear();
  const istM = ist.getUTCMonth();
  const istD = ist.getUTCDate();
  const startOfToday = new Date(Date.UTC(istY, istM, istD) - IST_OFFSET_MIN * 60_000);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const startOfTomorrow = endOfToday;
  const lookAheadEnd = new Date(startOfTomorrow.getTime() + 3 * 24 * 60 * 60 * 1000);
  return { startOfToday, endOfToday, startOfTomorrow, lookAheadEnd };
}

function formatDayHeader(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatDayShort(d: Date): string {
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

function summary(upcoming: number, done: number): string {
  if (upcoming === 0 && done === 0) return 'No sessions on the calendar.';
  const parts: string[] = [];
  if (upcoming > 0)
    parts.push(`${upcoming} session${upcoming === 1 ? '' : 's'} coming up`);
  if (done > 0) parts.push(`${done} done`);
  return parts.join(' · ');
}
