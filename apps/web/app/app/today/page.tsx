import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CARE_ENGINE_CONSTANTS } from '@cureocity/clinical';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';
import { TodaySessionCard } from '@/components/app/TodaySessionCard';
import { TodayAttentionQueue } from '@/components/app/TodayAttentionQueue';
import { FirstRunChecklist } from '@/components/app/FirstRunChecklist';
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
import { prioritizeTodayItems, type TodayAttentionItem } from '@/lib/today-priority';
import { noteProcessingJourney } from '@/lib/note-processing-journey';
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
  if (therapist.vertical === 'DOCTOR') redirect('/app/clinic');
  // TS6 — the therapist's preferred capture picks the Start button's primary
  // action (LIVE unless they chose a batch-first preference).
  const defaultCapture: 'LIVE' | 'BATCH' =
    therapist.defaultCaptureMode && therapist.defaultCaptureMode !== 'LIVE' ? 'BATCH' : 'LIVE';

  const { startOfToday, endOfToday, startOfTomorrow, lookAheadEnd } = computeDayBoundaries();

  const now = new Date();
  const responseCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [
    rawTodayRows,
    rawUpcomingRows,
    rawClients,
    rawAttentionSessions,
    rawNoteWork,
    rawClientResponses,
    rawOverdueAssignments,
  ] = await Promise.all([
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
      // Same rule as the record picker: a discharged client can walk back in
      // (a new session reopens care as a fresh episode).
      where: {
        psychologistId: therapist.id,
        deletedAt: null,
        status: { in: ['ACTIVE', 'PAUSED', 'DISCHARGED'] },
      },
      // The name is envelope-encrypted, so alphabetical ordering can't run in
      // SQL — fetch by a stable key and sort by the decrypted name below.
      orderBy: { createdAt: 'asc' },
      select: { id: true, fullNameEncrypted: true, preferredModality: true },
    }),
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        status: { in: ['IN_PROGRESS', 'SCHEDULED'] },
        client: { deletedAt: null },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 12,
      select: {
        id: true,
        status: true,
        scheduledAt: true,
        clientId: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.session.findMany({
      where: {
        psychologistId: therapist.id,
        status: 'COMPLETED',
        noteDraft: { status: { in: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'] } },
        OR: [{ therapyNote: null }, { therapyNote: { is: { locked: false } } }],
        client: { deletedAt: null },
      },
      orderBy: { endedAt: 'asc' },
      select: {
        id: true,
        endedAt: true,
        clientId: true,
        noteDraft: { select: { status: true } },
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.instrumentResponse.findMany({
      where: {
        psychologistId: therapist.id,
        administrationMode: 'SELF',
        administeredAt: { gte: responseCutoff },
        client: { deletedAt: null },
      },
      orderBy: { administeredAt: 'desc' },
      take: 5,
      select: {
        id: true,
        instrumentKey: true,
        administeredAt: true,
        clientId: true,
        client: { select: { fullNameEncrypted: true } },
      },
    }),
    prisma.exerciseAssignment.findMany({
      where: {
        psychologistId: therapist.id,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
        dueAt: { lt: now },
        client: { deletedAt: null },
      },
      orderBy: { dueAt: 'asc' },
      take: 5,
      select: {
        id: true,
        dueAt: true,
        clientId: true,
        client: { select: { fullNameEncrypted: true } },
      },
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

  const attentionItems: TodayAttentionItem[] = prioritizeTodayItems(
    await Promise.all([
      ...[
        rawAttentionSessions.find((session) => session.status === 'IN_PROGRESS'),
        rawAttentionSessions.find(
          (session) => session.status === 'SCHEDULED' && session.scheduledAt >= now,
        ),
      ]
        .filter((session): session is NonNullable<typeof session> => session !== undefined)
        .map(async (session) => ({
          id: session.id,
          kind: (session.status === 'IN_PROGRESS'
            ? 'ACTIVE_SESSION'
            : 'FUTURE_SESSION') as TodayAttentionItem['kind'],
          occurredAt: session.scheduledAt.toISOString(),
          title: await decryptClientField(therapist.id, session.client.fullNameEncrypted),
          href:
            session.status === 'IN_PROGRESS'
              ? `/app/sessions/${session.id}/live`
              : `/app/sessions/${session.id}`,
          ctaLabel: session.status === 'IN_PROGRESS' ? 'Resume session' : 'Prepare for session',
        })),
      ...rawNoteWork.map(async (session) => {
        const journey = noteProcessingJourney(session.noteDraft!.status);
        return {
          id: session.id,
          kind: journey.queueKind,
          occurredAt: (session.endedAt ?? now).toISOString(),
          title: await decryptClientField(therapist.id, session.client.fullNameEncrypted),
          detail: journey.message,
          href: `/app/sessions/${session.id}?tab=note`,
          ctaLabel:
            journey.state === 'NEEDS_ATTENTION'
              ? 'Resume generation'
              : journey.state === 'READY_TO_REVIEW'
                ? 'Review & Close'
                : 'View progress',
        };
      }),
      ...rawClientResponses.map(async (response) => ({
        id: response.id,
        kind: 'CLIENT_RESPONSE' as const,
        occurredAt: response.administeredAt.toISOString(),
        title: await decryptClientField(therapist.id, response.client.fullNameEncrypted),
        detail: `${response.instrumentKey} self-check-in completed`,
        href: `/app/clients/${response.clientId}/journey#measure-${response.instrumentKey.toLowerCase()}`,
        ctaLabel: 'Review response',
      })),
      ...rawAttentionSessions
        .filter((session) => session.status === 'SCHEDULED' && session.scheduledAt < now)
        .slice(0, 3)
        .map(async (session) => ({
          id: session.id,
          kind: 'OVERDUE_WORK' as const,
          occurredAt: session.scheduledAt.toISOString(),
          title: await decryptClientField(therapist.id, session.client.fullNameEncrypted),
          detail: 'Scheduled session still unresolved',
          href: `/app/sessions/${session.id}`,
          ctaLabel: 'Resolve session',
        })),
      ...rawOverdueAssignments.map(async (assignment) => ({
        id: assignment.id,
        kind: 'OVERDUE_WORK' as const,
        occurredAt: (assignment.dueAt ?? now).toISOString(),
        title: await decryptClientField(therapist.id, assignment.client.fullNameEncrypted),
        detail: 'Exercise follow-up is overdue',
        href: `/app/clients/${assignment.clientId}/journey`,
        ctaLabel: 'Review exercise',
      })),
    ]),
    now,
  ).slice(0, 12);

  const nowAndUpcoming = todayRows.filter(
    (s) => s.status === 'IN_PROGRESS' || (s.status === 'SCHEDULED' && s.scheduledAt >= now),
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

      <FirstRunChecklist psychologistId={therapist.id} />
      <TodayAttentionQueue items={attentionItems} />

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
