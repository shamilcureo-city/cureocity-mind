import Link from 'next/link';
import { CARE_ENGINE_CONSTANTS } from '@cureocity/clinical';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { TodaySessionCard } from '@/components/app/TodaySessionCard';
import { ScheduleSessionPanel } from '@/components/app/ScheduleSessionPanel';
import { WalkInSheet } from '@/components/app/WalkInSheet';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import {
  computeDayBoundaries,
  formatDayHeader,
  formatDayShort,
  formatIstTime as formatTime,
} from '@/lib/ist';
import { decryptClientField } from '@/lib/client-pii';
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
  // TS6 — the therapist's preferred capture picks the Start button's primary
  // action (LIVE unless they chose a batch-first preference).
  const defaultCapture: 'LIVE' | 'BATCH' =
    therapist.defaultCaptureMode && therapist.defaultCaptureMode !== 'LIVE' ? 'BATCH' : 'LIVE';

  const { startOfToday, endOfToday, startOfTomorrow, lookAheadEnd } = computeDayBoundaries();

  const [rawTodayRows, rawUpcomingRows, rawClients] = await Promise.all([
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        scheduledAt: { gte: startOfToday, lt: endOfToday },
        // Archived clients (deletedAt set) drop off the day board.
        client: { deletedAt: null },
      },
      orderBy: { scheduledAt: 'asc' },
      select: sessionSelect,
    }),
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        status: 'SCHEDULED',
        scheduledAt: { gte: startOfTomorrow, lt: lookAheadEnd },
        // Archived clients (deletedAt set) drop off the day board.
        client: { deletedAt: null },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 8,
      select: sessionSelect,
    }),
    prisma.client.findMany({
      where: { psychologistId: therapist.id, deletedAt: null, status: 'ACTIVE' },
      // The name is envelope-encrypted, so alphabetical ordering can't run in
      // SQL — fetch by a stable key and sort by the decrypted name below.
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullNameEncrypted: true, preferredModality: true },
    }),
  ]);

  // Read cutover — decrypt the client name into each row before the sync
  // card / dropdown mappers read it.
  const decSessionName = async <T extends { client: { fullNameEncrypted: string | null } }>(
    s: T,
  ): Promise<T & { client: T['client'] & { fullName: string } }> => ({
    ...s,
    client: {
      ...s.client,
      fullName: await decryptClientField(therapist.id, s.client.fullNameEncrypted),
    },
  });
  const [todayRows, upcomingRows, clients] = await Promise.all([
    Promise.all(rawTodayRows.map(decSessionName)),
    Promise.all(rawUpcomingRows.map(decSessionName)),
    Promise.all(
      rawClients.map(async (c) => ({
        ...c,
        fullName: await decryptClientField(therapist.id, c.fullNameEncrypted),
      })),
    ).then((list) => list.sort((a, b) => a.fullName.localeCompare(b.fullName))),
  ]);

  const nowAndUpcoming = todayRows.filter(
    (s) => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS',
  );
  const doneToday = todayRows.filter((s) => s.status === 'COMPLETED');
  const otherToday = todayRows.filter(
    (s) => s.status === 'NO_SHOW' || s.status === 'CANCELLED' || s.status === 'RESCHEDULED',
  );

  // TS7.2 — at any moment exactly one session matters: the in-progress one,
  // else the next scheduled. It gets the hero treatment; everything else on
  // the day becomes one quiet, time-ordered timeline.
  const hero = nowAndUpcoming[0] ?? null;
  const restOfDay = [...nowAndUpcoming.slice(1), ...doneToday, ...otherToday].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
  );

  // Recents for the walk-in sheet: whoever is on today's board or in the
  // look-ahead is likely the person standing in the room.
  const recentClientIds = [...new Set([...todayRows, ...upcomingRows].map((s) => s.clientId))];

  // TS7.4 — due-measure nudges on the day board. A light approximation of
  // the care engine's verdict (tracked instrument, ≥1 score, older than the
  // re-measure cadence); the chip links to the Journey card, which holds the
  // authoritative state and the one-tap send. One grouped query, no N+1.
  const todayClientIds = [...new Set(todayRows.map((s) => s.clientId))];
  const dueByClient = new Map<string, string>();
  if (todayClientIds.length > 0) {
    const latestScores = await prisma.instrumentResponse.groupBy({
      by: ['clientId', 'instrumentKey'],
      where: { clientId: { in: todayClientIds } },
      _max: { administeredAt: true },
    });
    const dueCutoff = Date.now() - CARE_ENGINE_CONSTANTS.REMEASURE_DUE_DAYS * 24 * 60 * 60 * 1000;
    for (const row of latestScores) {
      const last = row._max.administeredAt;
      if (!last || last.getTime() > dueCutoff) continue;
      if (!dueByClient.has(row.clientId)) {
        dueByClient.set(row.clientId, row.instrumentKey === 'GAD7' ? 'GAD-7' : 'PHQ-9');
      }
    }
  }

  return (
    <Container className="py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Today · {formatDayHeader(startOfToday)}
          </p>
          <h1 className="mt-1 font-serif text-3xl">
            {hero ? 'Up next' : doneToday.length > 0 ? 'All done for today' : 'Your day'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            {summary(nowAndUpcoming.length, doneToday.length)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WalkInSheet
            clients={clients.map((c) => ({ id: c.id, fullName: c.fullName }))}
            recentClientIds={recentClientIds}
            defaultCapture={defaultCapture}
          />
          <ScheduleSessionPanel clients={clients} />
        </div>
      </header>

      {hero ? (
        <section className="mt-6">
          <TodaySessionCard
            session={toCardProps(hero)}
            defaultCapture={defaultCapture}
            variant="hero"
          />
        </section>
      ) : (
        <Card className="mt-6 p-8 text-center text-sm text-[var(--color-ink-2)]">
          {todayRows.length === 0
            ? 'Nothing scheduled today. Book a slot with Schedule session, or start a Walk-in.'
            : 'No more sessions scheduled today — the timeline below shows how the day went.'}
        </Card>
      )}

      {restOfDay.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
            Rest of today
          </h2>
          <ul className="space-y-2">
            {restOfDay.map((s) => (
              <li key={s.id}>
                <TodaySessionCard
                  session={toCardProps(s)}
                  defaultCapture={defaultCapture}
                  variant="row"
                  dueMeasure={dueByClient.get(s.clientId) ?? null}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
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
  captureMode: true,
  clientId: true,
  client: { select: { id: true, fullNameEncrypted: true, isDemo: true } },
  noteDraft: { select: { status: true } },
  therapyNote: { select: { id: true } },
} as const;

function toCardProps(row: {
  id: string;
  status: string;
  scheduledAt: Date;
  modality: string | null;
  kind: string;
  captureMode: string | null;
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
    captureMode: row.captureMode,
  };
}

// ---------------------------------------------------------------------------
// Summary line (IST date helpers now live in @/lib/ist).
// ---------------------------------------------------------------------------

function summary(upcoming: number, done: number): string {
  if (upcoming === 0 && done === 0) return 'No sessions on the calendar.';
  const parts: string[] = [];
  if (upcoming > 0) parts.push(`${upcoming} session${upcoming === 1 ? '' : 's'} coming up`);
  if (done > 0) parts.push(`${done} done`);
  return parts.join(' · ');
}
