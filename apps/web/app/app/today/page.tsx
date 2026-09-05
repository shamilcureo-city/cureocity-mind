import { notFound, redirect } from 'next/navigation';
import { Prisma } from '@prisma/client';
import { CARE_ENGINE_CONSTANTS } from '@cureocity/clinical';
import { MindTodayWorkspace } from '@/components/app/MindTodayWorkspace';
import { buildMindTodayProgress, isFinalizedMindNote } from '@/components/app/MindTodayProgress';
import { FirstRunChecklist } from '@/components/app/FirstRunChecklist';
import { ScheduleSessionPanel } from '@/components/app/ScheduleSessionPanel';
import { WalkInSheet } from '@/components/app/WalkInSheet';
import { requireOnboardedPsychologist } from '@/lib/auth-page';
import { computeDayBoundaries, formatDayHeader } from '@/lib/ist';
import { decryptClientField } from '@/lib/client-pii';
import { prioritizeTodayItems, type TodayAttentionItem } from '@/lib/today-priority';
import { noteProcessingJourney } from '@/lib/note-processing-journey';
import { prisma } from '@/lib/prisma';
import { getEffectiveCapabilities } from '@/lib/capabilities';
import { dedupeLatestShareActivity } from '@/lib/client-care-home-dedupe';
import { homeworkResponseDetail } from '@/lib/mind-care-loop';
import { dedupeTodayCrossSource } from '@/lib/today-cross-source-dedupe';
import { selectAuthoritativeTodayHero } from '@/lib/today-hero';
import { canOpenMindPage, loadOptionalCapabilityData } from '@/lib/mind-page-capabilities';

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
  const effective = await getEffectiveCapabilities(therapist.id);
  if (!canOpenMindPage('today', effective.capabilities)) notFound();
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
    rawActiveSession,
    rawNextFutureSession,
    rawAttentionSessions,
    rawNoteWork,
    rawClientResponses,
    rawOverdueAssignments,
    rawRefreshRequests,
    rawCompletedHomework,
    rawShareActivity,
    rawFailedShareActivity,
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
    prisma.session.findFirst({
      where: {
        psychologistId: therapist.id,
        status: 'IN_PROGRESS',
        client: { deletedAt: null },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: sessionSelect,
    }),
    prisma.session.findFirst({
      where: {
        psychologistId: therapist.id,
        status: 'SCHEDULED',
        scheduledAt: { gte: now },
        client: { deletedAt: null },
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      select: sessionSelect,
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
    loadOptionalCapabilityData(
      effective.capabilities,
      'MEASUREMENT_BASED_CARE',
      () =>
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
            sourcePatientShareId: true,
            sourceShareBatchId: true,
            clientId: true,
            client: { select: { fullNameEncrypted: true } },
          },
        }),
      [],
    ),
    loadOptionalCapabilityData(
      effective.capabilities,
      'THERAPY_WORKFLOWS',
      () =>
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
      [],
    ),
    loadOptionalCapabilityData(
      effective.capabilities,
      'PATIENT_SHARING',
      () =>
        prisma.patientShare.findMany({
          where: {
            psychologistId: therapist.id,
            refreshRequestedAt: { gte: responseCutoff },
            client: { deletedAt: null },
          },
          orderBy: { refreshRequestedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            clientId: true,
            refreshRequestedAt: true,
            client: { select: { fullNameEncrypted: true } },
          },
        }),
      [],
    ),
    loadOptionalCapabilityData(
      effective.capabilities,
      'THERAPY_WORKFLOWS',
      () =>
        prisma.exerciseAssignment.findMany({
          where: {
            psychologistId: therapist.id,
            respondedAt: { gte: responseCutoff },
            NOT: { response: { equals: Prisma.DbNull } },
            client: { deletedAt: null },
          },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            clientId: true,
            completedAt: true,
            respondedAt: true,
            responseShareId: true,
            responseShareBatchId: true,
            updatedAt: true,
            response: true,
            client: { select: { fullNameEncrypted: true } },
          },
        }),
      [],
    ),
    loadOptionalCapabilityData(
      effective.capabilities,
      'PATIENT_SHARING',
      () =>
        prisma.patientShare.findMany({
          where: {
            psychologistId: therapist.id,
            client: { deletedAt: null },
            openedAt: { gte: responseCutoff },
          },
          orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          // At most three channel rows belong to one fanout. Over-fetch before
          // deduping so one batch cannot crowd seven other client events out.
          take: 24,
          select: {
            id: true,
            shareBatchId: true,
            clientId: true,
            status: true,
            createdAt: true,
            openedAt: true,
            client: { select: { fullNameEncrypted: true } },
          },
        }),
      [],
    ),
    loadOptionalCapabilityData(
      effective.capabilities,
      'PATIENT_SHARING',
      () =>
        prisma.patientShare.findMany({
          where: {
            psychologistId: therapist.id,
            client: { deletedAt: null },
            createdAt: { gte: responseCutoff },
            status: { in: ['TRANSIENT_FAILURE', 'PERMANENT_FAILURE'] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 24,
          select: {
            id: true,
            shareBatchId: true,
            clientId: true,
            status: true,
            createdAt: true,
            openedAt: true,
            client: { select: { fullNameEncrypted: true } },
          },
        }),
      [],
    ),
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
  const [todayRows, upcomingRows, clients, activeSession, nextFutureSession] = await Promise.all([
    Promise.all(rawTodayRows.map(decSessionName)),
    Promise.all(rawUpcomingRows.map(decSessionName)),
    Promise.all(
      rawClients.map(async (c) => ({
        ...c,
        fullName: await decryptClientField(therapist.id, c.fullNameEncrypted),
      })),
    ).then((list) => list.sort((a, b) => a.fullName.localeCompare(b.fullName))),
    rawActiveSession ? decSessionName(rawActiveSession) : null,
    rawNextFutureSession ? decSessionName(rawNextFutureSession) : null,
  ]);

  const queuedAttentionItems: TodayAttentionItem[] = prioritizeTodayItems(
    dedupeTodayCrossSource(
      await Promise.all([
        ...[rawActiveSession, rawNextFutureSession]
          .filter((session): session is NonNullable<typeof session> => session !== null)
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
          id: `checkin:${response.id}`,
          clientId: response.clientId,
          event: 'CHECKIN_RESPONSE' as const,
          sourceShareId: response.sourcePatientShareId ?? undefined,
          sourceShareBatchId: response.sourceShareBatchId ?? undefined,
          kind: 'CLIENT_RESPONSE' as const,
          occurredAt: response.administeredAt.toISOString(),
          title: await decryptClientField(therapist.id, response.client.fullNameEncrypted),
          detail: `${response.instrumentKey} self-check-in completed`,
          href: `/app/clients/${response.clientId}/journey#measure-${response.instrumentKey.toLowerCase()}`,
          ctaLabel: 'Review response',
        })),
        ...rawRefreshRequests.map(async (share) => ({
          id: `refresh:${share.id}`,
          kind: 'CLIENT_RESPONSE' as const,
          occurredAt: share.refreshRequestedAt!.toISOString(),
          title: await decryptClientField(therapist.id, share.client.fullNameEncrypted),
          detail: 'Client requested a fresh private link',
          href: `/app/clients/${share.clientId}/shared`,
          ctaLabel: 'Review shared items',
        })),
        ...rawCompletedHomework.map(async (assignment) => ({
          id: `homework:${assignment.id}`,
          clientId: assignment.clientId,
          assignmentId: assignment.id,
          sourceShareId: assignment.responseShareId ?? undefined,
          sourceShareBatchId: assignment.responseShareBatchId ?? undefined,
          event: 'HOMEWORK_RESPONSE' as const,
          kind: 'CLIENT_RESPONSE' as const,
          occurredAt: assignment.respondedAt!.toISOString(),
          responseRecordedAt: assignment.respondedAt!.toISOString(),
          title: await decryptClientField(therapist.id, assignment.client.fullNameEncrypted),
          detail: homeworkResponseDetail(assignment.response),
          href: `/app/clients/${assignment.clientId}/shared`,
          ctaLabel: 'Review homework',
        })),
        ...dedupeLatestShareActivity([...rawShareActivity, ...rawFailedShareActivity], 8).map(
          async (share) => ({
            id: `share:${share.id}`,
            clientId: share.clientId,
            shareId: share.id,
            shareBatchId: share.shareBatchId ?? undefined,
            event: share.hasFailure ? ('SHARE_FAILURE' as const) : ('SHARE_OPEN' as const),
            kind: 'CLIENT_RESPONSE' as const,
            occurredAt: (share.openedAt ?? share.createdAt).toISOString(),
            title: await decryptClientField(therapist.id, share.client.fullNameEncrypted),
            detail: share.hasFailure
              ? share.hasOpened
                ? 'Shared item opened; another delivery channel failed'
                : 'Shared-item delivery failed'
              : 'Client opened a shared item',
            href: `/app/clients/${share.clientId}/shared`,
            ctaLabel: 'Review shared items',
          }),
        ),
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
          clientId: assignment.clientId,
          assignmentId: assignment.id,
          event: 'HOMEWORK_OVERDUE' as const,
          kind: 'OVERDUE_WORK' as const,
          occurredAt: (assignment.dueAt ?? now).toISOString(),
          title: await decryptClientField(therapist.id, assignment.client.fullNameEncrypted),
          detail: 'Exercise follow-up is overdue',
          href: `/app/clients/${assignment.clientId}/journey`,
          ctaLabel: 'Review exercise',
        })),
      ]),
    ),
    now,
  );

  // TS7.2 — at any moment exactly one session matters: the authoritative
  // in-progress one, else the authoritative next scheduled session. It may
  // sit outside today's display boundary, so do not derive it from todayRows.
  const { hero } = selectAuthoritativeTodayHero(activeSession, nextFutureSession, todayRows);
  const restOfDay = todayRows
    .filter((session) => session.id !== hero?.id)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  // The authoritative session has one home. All other returned work remains
  // visible; in particular, note failures cannot fall behind a display limit.
  const attentionItems = queuedAttentionItems.filter(
    (item) =>
      !(item.id === hero?.id && (item.kind === 'ACTIVE_SESSION' || item.kind === 'FUTURE_SESSION')),
  );
  const progress = buildMindTodayProgress(todayRows);

  // Recents for the walk-in sheet: whoever is on today's board or in the
  // look-ahead is likely the person standing in the room.
  const recentClientIds = [...new Set([...todayRows, ...upcomingRows].map((s) => s.clientId))];

  // TS7.4 — due-measure nudges on the day board. A light approximation of
  // the care engine's verdict (tracked instrument, ≥1 score, older than the
  // re-measure cadence); the chip links to the Journey card, which holds the
  // authoritative state and the one-tap send. One grouped query, no N+1.
  const todayClientIds = [...new Set(todayRows.map((s) => s.clientId))];
  const dueByClient = new Map<string, string>();
  if (effective.capabilities.has('MEASUREMENT_BASED_CARE') && todayClientIds.length > 0) {
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
    <MindTodayWorkspace
      dateLabel={formatDayHeader(startOfToday)}
      hero={hero ? toCardProps(hero) : null}
      agenda={restOfDay.map((session) => ({
        session: toCardProps(session),
        dueMeasure: dueByClient.get(session.clientId) ?? null,
      }))}
      upcoming={upcomingRows.filter((session) => session.id !== hero?.id).map(toCardProps)}
      attentionItems={attentionItems}
      defaultCapture={defaultCapture}
      progress={progress}
      firstRun={<FirstRunChecklist psychologistId={therapist.id} />}
      actions={
        <>
          <WalkInSheet
            clients={clients.map((c) => ({ id: c.id, fullName: c.fullName }))}
            recentClientIds={recentClientIds}
            defaultCapture={defaultCapture}
          />
          <ScheduleSessionPanel clients={clients} />
        </>
      }
    />
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
  therapyNote: { select: { id: true, locked: true, signedAt: true } },
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
  therapyNote: { id: string; locked: boolean; signedAt: Date } | null;
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
    hasSignedNote: isFinalizedMindNote(row.therapyNote),
    draftStatus: row.noteDraft?.status ?? null,
    captureMode: row.captureMode,
  };
}
