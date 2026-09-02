import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  PatientShareSnapshotSchema,
  CLIENT_CARE_HOME_ORDER,
  ClientCareHomeSchema,
} from '@cureocity/contracts';
import { resolveClient } from '@/lib/auth-server';
import { mindJourneyFlagEnabledFromEnv } from '@/lib/mind-journey-flags';
import { prisma } from '@/lib/prisma';
import { enforceSameOriginMutation } from '@/lib/same-origin-mutation';
import { careHomeShareHref, linkHomeworkAssignments } from '@/lib/sprint5-final-behavior';
import { writeAudit } from '@/lib/audit';
import { lockShareFamily } from '@/lib/share-family-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const shareSelect = Prisma.validator<Prisma.PatientShareSelect>()({
  id: true,
  artefactType: true,
  artefactId: true,
  subject: true,
  snapshot: true,
  createdAt: true,
  shareToken: true,
  expiresAt: true,
  status: true,
});

export async function GET(req: NextRequest) {
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const client = await prisma.client.findFirst({
    where: { id: auth.value.clientId, deletedAt: null },
    select: { id: true, psychologistId: true, psychologist: { select: { vertical: true } } },
  });
  if (!client || !mindJourneyFlagEnabledFromEnv('clientCareLoop', client.psychologist.vertical)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const [summaryIds, historyShares, assignments, upcoming] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ranked."id"
      FROM (
        SELECT DISTINCT ON ("artefactType", "artefactId")
          "id", "createdAt"
        FROM "patient_shares"
        WHERE "clientId" = ${client.id}
          AND "psychologistId" = ${client.psychologistId}
          AND "artefactType" NOT IN (
            'AFTER_VISIT_SUMMARY'::"PatientShareArtefactType",
            'CHRONIC_PROGRESS_REPORT'::"PatientShareArtefactType",
            'RX_PAD'::"PatientShareArtefactType"
          )
          AND "status" IN ('SENT'::"PatientShareStatus", 'OPENED'::"PatientShareStatus")
        ORDER BY "artefactType", "artefactId", "createdAt" DESC, "id" DESC
      ) ranked
      ORDER BY ranked."createdAt" DESC, ranked."id" DESC
      LIMIT 100
    `),
    prisma.patientShare.findMany({
      where: {
        clientId: client.id,
        psychologistId: client.psychologistId,
        artefactType: { notIn: ['AFTER_VISIT_SUMMARY', 'CHRONIC_PROGRESS_REPORT', 'RX_PAD'] },
        status: { in: ['SENT', 'OPENED'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: shareSelect,
    }),
    prisma.exerciseAssignment.findMany({
      where: {
        clientId: client.id,
        psychologistId: client.psychologistId,
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
    prisma.session.findFirst({
      where: {
        clientId: client.id,
        psychologistId: client.psychologistId,
        status: 'SCHEDULED',
        scheduledAt: { gte: new Date() },
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      select: { id: true, scheduledAt: true },
    }),
  ]);
  const summaryRows = await prisma.patientShare.findMany({
    where: { id: { in: summaryIds.map((row) => row.id) } },
    select: shareSelect,
  });
  const summaryOrder = new Map(summaryIds.map((row, index) => [row.id, index]));
  summaryRows.sort((a, b) => summaryOrder.get(a.id)! - summaryOrder.get(b.id)!);
  const validShares = mapValidShares(summaryRows);
  const historyItems = mapValidShares(historyShares).map((share) => share.item);
  const shareItems = validShares.map((share) => share.item);
  const activeHomework = linkHomeworkAssignments(
    assignments.map((a) => ({
      id: a.id,
      title: a.customDescription ?? a.exerciseId ?? 'Homework',
      detail: a.frequency ?? a.therapistNote,
      occurredAt: a.assignedAt.toISOString(),
      href: null,
      snapshot: null,
    })),
    validShares.map((share) => ({
      artefactType: share.artefactType,
      artefactId: share.artefactId,
      status: share.status,
      href: share.item.href,
      snapshot: share.item.snapshot,
    })),
  );
  const checkins = shareItems.filter((item) => item.snapshot?.kind === 'INSTRUMENT_CHECKIN');
  const goals = shareItems.filter(
    (item) => item.snapshot?.kind === 'TREATMENT_PLAN' || item.snapshot?.kind === 'PROGRESS_REPORT',
  );
  const resources = shareItems.filter((item) => item.snapshot?.kind === 'THERAPY_SCRIPT');
  const next = activeHomework[0] ?? checkins[0];
  const sections = [
    { kind: 'WHAT_TO_DO_NEXT', items: next ? [next] : [] },
    {
      kind: 'UPCOMING_SESSION',
      items: upcoming
        ? [
            {
              id: upcoming.id,
              title: 'Upcoming session',
              detail: null,
              occurredAt: upcoming.scheduledAt.toISOString(),
              href: null,
              snapshot: null,
            },
          ]
        : [],
    },
    { kind: 'HOMEWORK_CHECKINS', items: [...activeHomework, ...checkins].slice(0, 100) },
    { kind: 'GOALS_PROGRESS', items: goals.slice(0, 100) },
    { kind: 'THERAPIST_RESOURCES', items: resources.slice(0, 100) },
    { kind: 'HISTORY', items: historyItems.slice(0, 100) },
  ];
  // Keep the literal exported order visible and fail loudly during development.
  if (sections.some((section, index) => section.kind !== CLIENT_CARE_HOME_ORDER[index]))
    throw new Error('care home section order');
  const response = ClientCareHomeSchema.parse({ clientId: client.id, sections });
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

export async function POST(req: NextRequest) {
  const crossSite = enforceSameOriginMutation(req);
  if (crossSite) return crossSite;
  const auth = await resolveClient(req);
  if (!auth.ok) return auth.response;
  const client = await prisma.client.findFirst({
    where: { id: auth.value.clientId, deletedAt: null },
    select: { id: true, psychologist: { select: { vertical: true } } },
  });
  if (!client || !mindJourneyFlagEnabledFromEnv('clientCareLoop', client.psychologist.vertical)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const body = (await req.json().catch(() => null)) as { shareId?: unknown } | null;
  if (!body || typeof body.shareId !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const now = new Date();
  const cooldown = new Date(now.getTime() - 60 * 60 * 1000);
  const shareId = body.shareId;
  const candidate = await prisma.patientShare.findFirst({
    where: { id: shareId, clientId: auth.value.clientId },
    select: { id: true, shareBatchId: true },
  });
  if (!candidate) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const requested = await prisma.$transaction(async (tx) => {
    await lockShareFamily(tx, candidate);
    const share = await tx.patientShare.findFirst({
      where: {
        id: shareId,
        clientId: auth.value.clientId,
        status: { in: ['SENT', 'OPENED'] },
        expiresAt: { lte: now },
      },
      select: { id: true, clientId: true, psychologistId: true },
    });
    if (!share) return false;
    const changed = await tx.patientShare.updateMany({
      where: {
        id: share.id,
        OR: [{ refreshRequestedAt: null }, { refreshRequestedAt: { lt: cooldown } }],
      },
      data: { refreshRequestedAt: now, refreshRequestCount: { increment: 1 } },
    });
    if (changed.count === 1) {
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'PATIENT_SHARE_REFRESH_REQUESTED',
          targetType: 'PatientShare',
          targetId: share.id,
          metadata: { clientId: share.clientId, psychologistId: share.psychologistId },
        },
        tx,
      );
    }
    return true;
  });
  return NextResponse.json(requested ? { ok: true } : { error: 'Not found' }, {
    status: requested ? 200 : 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function mapValidShares(
  shares: Array<Prisma.PatientShareGetPayload<{ select: typeof shareSelect }>>,
) {
  return shares.flatMap((share) => {
    const parsed = PatientShareSnapshotSchema.safeParse(share.snapshot);
    if (!parsed.success) return [];
    return [
      {
        artefactType: share.artefactType,
        artefactId: share.artefactId,
        status: share.status,
        item: {
          id: share.id,
          title: share.subject,
          detail: null,
          occurredAt: share.createdAt.toISOString(),
          href: careHomeShareHref(share.id, share.shareToken, share.expiresAt),
          snapshot: parsed.data,
        },
      },
    ];
  });
}
