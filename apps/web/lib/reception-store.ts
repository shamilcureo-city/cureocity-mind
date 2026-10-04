import { createHmac } from 'node:crypto';
import {
  Prisma,
  type ReceptionRequest,
  type ReceptionSettings as SettingsRow,
} from '@prisma/client';
import { prisma } from './prisma';
import { decryptForTenant, encryptForTenant } from './tenant-crypto';
import { lockActiveClient } from './phi-write-lock';
import { getEntitlement, isBillingEnforced } from './billing';
import { computeSessionDefaults } from './session-defaults';
import { DEFAULT_BUILTIN_TEMPLATE_ID } from './builtin-templates';
import { nextClinicToken } from './clinic-queue';
import { writeAudit } from './audit';
import {
  defaultReceptionSettings,
  receptionSlots,
  ReceptionRequestInputSchema,
  ReceptionSettingsSchema,
  type ReceptionAction,
  type ReceptionRequestInput,
  type ReceptionRequestView,
  type ReceptionSettings,
  type ReceptionWorkspace,
  type PublicReception,
} from './reception';
import {
  ReceptionError,
  requireReceptionStorage,
  isReceptionTransactionConflict,
} from './reception-server';
import { acquireReceptionCalendarLock, loadReceptionBusyIntervals } from './reception-calendar';

const MINUTE = 60_000;

function settingsView(row: SettingsRow): ReceptionSettings {
  return ReceptionSettingsSchema.parse({
    ...(row.config as object),
    slug: row.slug,
    enabled: row.enabled,
    version: row.revision,
  });
}

function receptionSecret(): string {
  const secret = process.env['RECEPTION_RATE_LIMIT_SECRET'];
  if (!secret || secret.length < 32)
    throw new ReceptionError(503, 'Reception public requests are not configured.');
  return secret;
}

function fingerprint(value: string): string {
  return createHmac('sha256', receptionSecret()).update(value).digest('hex');
}

/** All callbacks contain database work only and are safe to retry after rollback. */
async function transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'ReadCommitted', timeout: 15_000 });
    } catch (error) {
      if (!isReceptionTransactionConflict(error) || attempt >= 2) throw error;
    }
  }
}

async function slots(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  settings: ReceptionSettings,
  now = new Date(),
) {
  const busy = await loadReceptionBusyIntervals(tx, psychologistId, {
    from: new Date(now.getTime() - 90 * MINUTE),
    to: new Date(now.getTime() + 15 * 24 * 60 * MINUTE),
    slotMinutes: settings.slotMinutes,
  });
  return receptionSlots(settings, busy, now);
}

async function owner(psychologistId: string) {
  const row = await prisma.psychologist.findFirst({
    where: { id: psychologistId, deletedAt: null },
    select: { id: true, fullName: true, vertical: true },
  });
  if (!row) throw new ReceptionError(404, 'Practice not found.');
  return row;
}

async function requestView(
  row: ReceptionRequest & { events: Array<{ id: string; kind: string; createdAt: Date }> },
): Promise<ReceptionRequestView> {
  const plaintext = await decryptForTenant(row.psychologistId, row.payloadEncrypted);
  if (!plaintext) throw new ReceptionError(503, 'Request details are temporarily unavailable.');
  const payload = ReceptionRequestInputSchema.parse(JSON.parse(plaintext));
  return {
    id: row.id,
    kind: payload.kind,
    status: row.status as ReceptionRequestView['status'],
    patientName: payload.patientName,
    patientPhone: payload.patientPhone,
    patientEmail: payload.patientEmail ?? null,
    message: payload.message,
    desiredStartAt: row.startAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    appointmentId: row.appointmentId,
    sessionId: row.sessionId,
    clientId: row.clientId,
    events: row.events.map((event) => ({
      id: event.id,
      action: event.kind,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function loadReceptionWorkspace(psychologistId: string): Promise<ReceptionWorkspace> {
  await requireReceptionStorage(prisma);
  const practitioner = await owner(psychologistId);
  // Closed enquiries must never displace unfinished work. Keep the two bounded
  // lists and the pending count in one read snapshot, including during approval.
  const [settings, pendingRequests, historyRequests, pendingCount, clients] =
    await prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.receptionSettings.findUnique({ where: { psychologistId } }),
          tx.receptionRequest.findMany({
            where: { psychologistId, status: 'NEW' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 200,
            include: { events: { orderBy: { createdAt: 'asc' } } },
          }),
          tx.receptionRequest.findMany({
            where: { psychologistId, status: { not: 'NEW' } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 201,
            include: { events: { orderBy: { createdAt: 'asc' } } },
          }),
          tx.receptionRequest.count({ where: { psychologistId, status: 'NEW' } }),
          tx.client.findMany({
            where: { psychologistId, deletedAt: null, status: 'ACTIVE', isDemo: false },
            select: { id: true, fullNameEncrypted: true },
            orderBy: { createdAt: 'desc' },
            take: 1000,
          }),
        ]),
      { isolationLevel: 'RepeatableRead', timeout: 15_000 },
    );
  return {
    settings: settings ? settingsView(settings) : defaultReceptionSettings(practitioner.fullName),
    practitionerName: practitioner.fullName,
    vertical: practitioner.vertical,
    requests: await Promise.all(
      [...pendingRequests, ...historyRequests.slice(0, 200)].map(requestView),
    ),
    pendingCount,
    hasMoreHistory: historyRequests.length > 200,
    clients: await Promise.all(
      clients.map(async (client) => ({
        id: client.id,
        name: client.fullNameEncrypted
          ? ((await decryptForTenant(psychologistId, client.fullNameEncrypted)) ?? '(unavailable)')
          : '(unavailable)',
      })),
    ),
  };
}

export async function saveReceptionSettings(
  psychologistId: string,
  input: ReceptionSettings,
): Promise<ReceptionSettings> {
  await requireReceptionStorage(prisma);
  await owner(psychologistId);
  return transaction(async (tx) => {
    await acquireReceptionCalendarLock(tx, psychologistId);
    const current = await tx.receptionSettings.findUnique({ where: { psychologistId } });
    if ((current?.revision ?? 0) !== input.version)
      throw new ReceptionError(409, 'Reception settings changed. Refresh before saving.');
    const { version: _version, ...config } = input;
    const saved = current
      ? await tx.receptionSettings.update({
          where: { psychologistId },
          data: { slug: input.slug, enabled: input.enabled, revision: { increment: 1 }, config },
        })
      : await tx.receptionSettings.create({
          data: { psychologistId, slug: input.slug, enabled: input.enabled, config },
        });
    await tx.receptionEvent.create({
      data: {
        psychologistId,
        kind: input.enabled ? 'SETTINGS_ENABLED_OR_UPDATED' : 'SETTINGS_DISABLED_OR_UPDATED',
      },
    });
    return settingsView(saved);
  });
}

async function publicDesk(tx: Prisma.TransactionClient, slug: string) {
  const row = await tx.receptionSettings.findFirst({
    where: {
      slug,
      enabled: true,
      psychologist: { deletedAt: null, status: 'ACTIVE', onboardingCompletedAt: { not: null } },
    },
    include: { psychologist: { select: { fullName: true, vertical: true } } },
  });
  if (!row) throw new ReceptionError(404, 'Reception is not available.');
  return row;
}

export async function loadPublicReception(slug: string): Promise<PublicReception> {
  await requireReceptionStorage(prisma);
  return transaction(async (tx) => {
    const desk = await publicDesk(tx, slug);
    const settings = settingsView(desk);
    return {
      practiceName: settings.practiceName,
      practitionerName: desk.psychologist.fullName,
      vertical: desk.psychologist.vertical,
      slug: settings.slug,
      timezone: settings.timezone,
      mode: settings.mode,
      slotMinutes: settings.slotMinutes,
      faqs: settings.faqs,
      slots: await slots(tx, desk.psychologistId, settings),
    };
  });
}

/** A fixed-window UPSERT is durable and atomic across processes. Both keys must pass. */
export async function consumeReceptionRateLimit(slug: string, req: Request): Promise<void> {
  await requireReceptionStorage(prisma);
  // Only trust headers that the deployment proxy overwrites; otherwise callers share a bucket.
  const forwarded =
    process.env['VERCEL'] === '1'
      ? req.headers.get('x-vercel-forwarded-for')
      : process.env['RECEPTION_TRUST_PROXY'] === 'true'
        ? req.headers.get('x-forwarded-for')
        : null;
  const source = forwarded?.split(',')[0]?.trim().slice(0, 128) || 'untrusted-source';
  const keys = [
    { key: fingerprint(`source:${source}`), max: 10 },
    { key: fingerprint(`desk:${slug}`), max: 100 },
  ];
  const now = new Date();
  const resetAt = new Date(now.getTime() + 60 * MINUTE);
  const allowed = await transaction(async (tx) => {
    await tx.receptionRateLimit.deleteMany({
      where: { resetAt: { lt: new Date(now.getTime() - 24 * 60 * MINUTE) } },
    });
    let ok = true;
    for (const bucket of keys) {
      const rows = await tx.$queryRaw<Array<{ hits: number }>>`
        INSERT INTO "reception_rate_limits" ("key", "hits", "resetAt")
        VALUES (${bucket.key}, 1, ${resetAt})
        ON CONFLICT ("key") DO UPDATE SET
          "hits" = CASE WHEN "reception_rate_limits"."resetAt" <= ${now} THEN 1 ELSE "reception_rate_limits"."hits" + 1 END,
          "resetAt" = CASE WHEN "reception_rate_limits"."resetAt" <= ${now} THEN ${resetAt} ELSE "reception_rate_limits"."resetAt" END
        RETURNING "hits"
      `;
      if (!rows[0] || rows[0].hits > bucket.max) {
        ok = false;
        break;
      }
    }
    return ok;
  });
  if (!allowed)
    throw new ReceptionError(
      429,
      'Too many requests. Please contact the practice directly or try later.',
    );
}

export async function submitReceptionRequest(
  slug: string,
  input: ReceptionRequestInput,
): Promise<{ requestId: string; status: 'NEW' }> {
  await requireReceptionStorage(prisma);
  const initial = await publicDesk(prisma, slug);
  const canonical = {
    ...input,
    ...(input.desiredStartAt
      ? { desiredStartAt: new Date(input.desiredStartAt).toISOString() }
      : {}),
  };
  const submissionHash = fingerprint(JSON.stringify(canonical));
  const payloadEncrypted = await encryptForTenant(
    initial.psychologistId,
    JSON.stringify(canonical),
  );
  return transaction(async (tx) => {
    await acquireReceptionCalendarLock(tx, initial.psychologistId);
    const desk = await publicDesk(tx, slug);
    if (desk.psychologistId !== initial.psychologistId)
      throw new ReceptionError(409, 'Reception changed. Refresh and try again.');
    const existing = await tx.receptionRequest.findUnique({
      where: {
        psychologistId_submissionId: {
          psychologistId: desk.psychologistId,
          submissionId: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (existing.submissionHash !== submissionHash)
        throw new ReceptionError(409, 'This submission identifier was already used.');
      // Never disclose review status, identity matches, appointment or session through public replay.
      return { requestId: existing.id, status: 'NEW' };
    }
    const available =
      input.kind === 'BOOKING'
        ? (await slots(tx, desk.psychologistId, settingsView(desk))).find(
            (slot) => slot.startAt === canonical.desiredStartAt,
          )
        : undefined;
    if (input.kind === 'BOOKING' && !available)
      throw new ReceptionError(409, 'That time is no longer available. Choose another time.');
    const request = await tx.receptionRequest.create({
      data: {
        psychologistId: desk.psychologistId,
        submissionId: input.idempotencyKey,
        submissionHash,
        kind: input.kind,
        payloadEncrypted,
        startAt: available ? new Date(available.startAt) : null,
        endAt: available ? new Date(available.endAt) : null,
        mode: available?.mode ?? null,
      },
    });
    await tx.receptionEvent.create({
      data: { psychologistId: desk.psychologistId, requestId: request.id, kind: 'RECEIVED' },
    });
    return { requestId: request.id, status: 'NEW' };
  });
}

export async function actOnReceptionRequest(
  psychologistId: string,
  id: string,
  action: ReceptionAction,
): Promise<ReceptionRequestView | { erased: true }> {
  await requireReceptionStorage(prisma);
  const practitioner = await owner(psychologistId);
  const row = await transaction(async (tx) => {
    // Global calendar lock always comes before the Client row lock, including erasure-safe writes.
    await acquireReceptionCalendarLock(tx, psychologistId);
    const current = await tx.receptionRequest.findFirst({ where: { id, psychologistId } });
    if (!current) throw new ReceptionError(404, 'Request not found.');
    if (action.action === 'ERASE') {
      if (action.confirmErase !== true)
        throw new ReceptionError(400, 'Confirm erasure before continuing.');
      await tx.receptionRequest.delete({ where: { id } });
      await tx.receptionEvent.create({ data: { psychologistId, kind: 'REQUEST_ERASED' } });
      return null;
    }
    const target =
      action.action === 'APPROVE_BOOKING'
        ? 'BOOKED'
        : action.action === 'DECLINE'
          ? 'DECLINED'
          : 'RESOLVED';
    if (
      current.status === target &&
      (action.action !== 'APPROVE_BOOKING' || current.clientId === action.clientId)
    ) {
      return tx.receptionRequest.findUniqueOrThrow({
        where: { id },
        include: { events: { orderBy: { createdAt: 'asc' } } },
      });
    }
    if (current.status !== 'NEW')
      throw new ReceptionError(409, 'This request has already been handled. Refresh the inbox.');
    if (action.action === 'RESOLVE' && current.kind === 'BOOKING')
      throw new ReceptionError(400, 'Approve or decline booking requests.');
    let appointmentId: string | undefined;
    let sessionId: string | undefined;
    let clientId: string | undefined;
    if (action.action === 'APPROVE_BOOKING') {
      if (
        action.identityVerified !== true ||
        current.kind !== 'BOOKING' ||
        !current.startAt ||
        !current.endAt
      )
        throw new ReceptionError(400, 'A booking and verified patient identity are required.');
      await lockActiveClient(tx, action.clientId, psychologistId);
      const client = await tx.client.findFirst({
        where: {
          id: action.clientId,
          psychologistId,
          deletedAt: null,
          isDemo: false,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          fullNameEncrypted: true,
          contactPhoneEncrypted: true,
          contactEmailEncrypted: true,
        },
      });
      if (!client || !client.fullNameEncrypted || !client.contactPhoneEncrypted)
        throw new ReceptionError(
          400,
          'Choose an active patient belonging to this practice with a complete contact record.',
        );
      // Same entitlement gates as ordinary session creation. SCHEDULED rows do
      // not consume trial/monthly consultations; normal session start still owns metering.
      if (isBillingEnforced()) {
        const entitlement = await getEntitlement(psychologistId, tx);
        if (
          (!entitlement.isPaidActive && entitlement.trialUsed >= entitlement.trialCap) ||
          (entitlement.isPaidActive &&
            entitlement.monthlySessionCap !== null &&
            entitlement.monthlyUsed >= entitlement.monthlySessionCap)
        ) {
          throw new ReceptionError(
            402,
            'The practice consultation limit has been reached. Review the plan before booking another visit.',
          );
        }
      }
      const defaults = await computeSessionDefaults(client.id, psychologistId, tx);
      const template = await tx.noteTemplate.findFirst({
        where: { psychologistId, isDefault: true },
        select: { id: true },
      });
      const desk = await tx.receptionSettings.findUnique({ where: { psychologistId } });
      if (!desk?.enabled)
        throw new ReceptionError(409, 'Enable reception before approving a booking.');
      const available = (await slots(tx, psychologistId, settingsView(desk))).find(
        (slot) =>
          slot.startAt === current.startAt!.toISOString() &&
          slot.endAt === current.endAt!.toISOString() &&
          slot.mode === current.mode,
      );
      if (!available)
        throw new ReceptionError(
          409,
          'This time is no longer available. Contact the requester to arrange another time.',
        );
      // Select the existing identity explicitly. Never turn unverified public contact into a client.
      const session = await tx.session.create({
        data: {
          psychologistId,
          clientId: client.id,
          status: 'SCHEDULED',
          scheduledAt: current.startAt,
          kind: defaults.kind,
          modality: defaults.modality,
          language: defaults.language,
          spokenLanguages: defaults.spokenLanguages,
          noteTemplateId:
            defaults.kind === 'INTAKE' ? null : (template?.id ?? DEFAULT_BUILTIN_TEMPLATE_ID),
          ...(practitioner.vertical === 'DOCTOR'
            ? { tokenNumber: await nextClinicToken(tx, psychologistId, current.startAt) }
            : {}),
        },
      });
      const appointment = await tx.appointment.create({
        data: {
          psychologistId,
          clientId: client.id,
          sessionId: session.id,
          status: 'CONFIRMED',
          startAt: current.startAt,
          endAt: current.endAt,
          mode: current.mode ?? 'IN_PERSON',
          patientNameEncrypted: client.fullNameEncrypted,
          patientPhoneEncrypted: client.contactPhoneEncrypted,
          patientEmailEncrypted: client.contactEmailEncrypted,
          suppressAutomaticMessages: true,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'SESSION_CREATED',
          targetType: 'Session',
          targetId: session.id,
          metadata: { clientId: client.id, source: 'reception-pilot' },
        },
        tx,
      );
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: psychologistId,
          action: 'APPOINTMENT_CONFIRMED',
          targetType: 'Appointment',
          targetId: appointment.id,
          metadata: { clientId: client.id, sessionId: session.id, source: 'reception-pilot' },
        },
        tx,
      );
      if (practitioner.vertical === 'THERAPIST') {
        const openEpisode = await tx.treatmentEpisode.findFirst({
          where: { clientId: client.id, psychologistId, status: 'OPEN' },
          select: { id: true },
        });
        if (!openEpisode) {
          const episode = await tx.treatmentEpisode.create({
            data: { clientId: client.id, psychologistId, status: 'OPEN' },
          });
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: psychologistId,
              action: 'TREATMENT_EPISODE_OPENED',
              targetType: 'TreatmentEpisode',
              targetId: episode.id,
              metadata: { clientId: client.id, sessionId: session.id, source: 'reception-pilot' },
            },
            tx,
          );
        }
      }
      clientId = client.id;
      sessionId = session.id;
      appointmentId = appointment.id;
    }
    const changed = await tx.receptionRequest.updateMany({
      where: { id, psychologistId, status: 'NEW', revision: current.revision },
      data: {
        status: target,
        revision: { increment: 1 },
        ...(clientId ? { clientId, sessionId, appointmentId } : {}),
      },
    });
    if (changed.count !== 1)
      throw new ReceptionError(409, 'This request changed. Refresh the inbox.');
    await tx.receptionEvent.create({
      data: { psychologistId, requestId: id, kind: action.action },
    });
    return tx.receptionRequest.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
  });
  return row ? requestView(row) : { erased: true };
}
