import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { Prisma, type PatientShareStatus } from '@prisma/client';
import type { PatientShareSnapshot } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { publicBaseUrl } from '@/lib/appointment-links';
import { shareChannels } from '@/lib/share-channels';
import {
  canOrdinarilyResend,
  classifyShareDelivery,
  recoverExpiredDispatch,
} from '@/lib/sprint5-final-behavior';
import { privateJson, privateResponse } from '@/lib/private-response';
import { decryptShareRecipientEnvelope } from '@/lib/share-recipient-envelope';
import { decryptForTenant } from '@/lib/tenant-crypto';
import { sendViaChannel } from '../../../share/route';
import { parseSharesPerHourCap } from '@/lib/share-rate-cap';
import { lockClientShareDispatch } from '@/lib/share-dispatch-safety';
import { lockShareFamily } from '@/lib/share-family-lock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const CAP = parseSharesPerHourCap(process.env['SHARES_PER_HOUR_CAP']);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(req, 'PATIENT_SHARING');
  if (!auth.ok) return privateResponse(auth.response);
  const { id } = await params;
  // Resolve provider readiness before leasing/creating a delivery attempt.
  const config = shareChannels();
  const now = new Date();
  const attempt = await prisma
    .$transaction(async (tx) => {
      const source = await tx.patientShare.findFirst({
        where: { id, psychologistId: auth.value.psychologistId },
        include: { client: true },
      });
      if (!source || source.client.deletedAt || source.status === 'REVOKED')
        throw new ResendNotFound();
      await lockShareFamily(tx, source);
      await lockClientShareDispatch(tx, source.clientId);
      const currentSource = await tx.patientShare.findUnique({
        where: { id: source.id },
        select: { status: true, client: { select: { deletedAt: true } } },
      });
      if (!currentSource || currentSource.status === 'REVOKED' || currentSource.client.deletedAt)
        throw new ResendNotFound();
      const requestedExpiredRefresh =
        !!source.refreshRequestedAt &&
        source.expiresAt <= now &&
        (source.status === 'SENT' || source.status === 'OPENED');
      if (!canOrdinarilyResend(source) && !requestedExpiredRefresh) throw new ResendNotFound();

      const recipient = await decryptShareRecipientEnvelope(
        source.psychologistId,
        source.recipientEnvelopeEncrypted,
        source.channel,
      );
      const therapistMessage = await decryptTherapistMessage(
        source.psychologistId,
        source.therapistMessageEncrypted,
      );
      if (!recipient || !therapistMessage.ok) throw new RecipientReconfirmationRequired();
      const destination = recipient.destination;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${source.psychologistId}))`;
      const existing = await tx.patientShare.findUnique({ where: { resendOfId: source.id } });
      if (existing) {
        const leaseExpired = existing.updatedAt <= new Date(now.getTime() - 5 * 60_000);
        if (existing.status === 'PENDING' && leaseExpired) {
          const recovery = recoverExpiredDispatch(existing);
          if (!recovery.retry) {
            const ambiguous = await tx.patientShare.update({
              where: { id: existing.id },
              data: {
                status: recovery.status,
                errorCode: recovery.errorCode,
                dispatchLeaseExpiresAt: null,
              },
            });
            await writeAudit(
              {
                actorType: 'SYSTEM',
                action: 'PATIENT_ARTEFACT_SHARED',
                targetType: 'PatientShare',
                targetId: ambiguous.id,
                metadata: {
                  clientId: source.clientId,
                  resentFromShareId: source.id,
                  channel: source.channel,
                  outcome: recovery.status,
                  errorCode: recovery.errorCode,
                },
              },
              tx,
            );
            return {
              row: ambiguous,
              source,
              recipient,
              therapistMessage,
              destination,
              leased: false as const,
            };
          }
          const leased = await tx.patientShare.update({
            where: { id: existing.id },
            data: {
              dispatchStartedAt: now,
              dispatchLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
            },
          });
          return {
            row: leased,
            source,
            recipient,
            therapistMessage,
            destination,
            leased: true as const,
          };
        }
        return {
          row: existing,
          source,
          recipient,
          therapistMessage,
          destination,
          leased: false as const,
        };
      }
      const cutoff = new Date(now.getTime() - 3_600_000);
      const reservations = await tx.shareRateReservation.findMany({
        where: { psychologistId: source.psychologistId, createdAt: { gte: cutoff } },
        select: { shareBatchId: true, fanout: true },
      });
      const recent = await tx.patientShare.count({
        where: {
          psychologistId: source.psychologistId,
          createdAt: { gte: cutoff },
          ...(reservations.length > 0 && {
            OR: [
              { shareBatchId: null },
              {
                shareBatchId: {
                  notIn: reservations.map((reservation) => reservation.shareBatchId),
                },
              },
            ],
          }),
        },
      });
      const reserved = reservations.reduce((sum, reservation) => sum + reservation.fanout, 0);
      if (recent + reserved + 1 > CAP) throw new ShareCapExceeded();
      const row = await tx.patientShare.create({
        data: {
          clientId: source.clientId,
          psychologistId: source.psychologistId,
          sessionId: source.sessionId,
          resendOfId: source.id,
          shareBatchId: source.shareBatchId ?? source.id,
          artefactType: source.artefactType,
          artefactId: source.artefactId,
          channel: source.channel,
          status: 'PENDING',
          shareToken: randomBytes(16).toString('base64url'),
          language: source.language,
          snapshot: source.snapshot as Prisma.InputJsonValue,
          subject: source.subject,
          toContact: null,
          recipientEnvelopeEncrypted: source.recipientEnvelopeEncrypted,
          therapistMessageEncrypted: source.therapistMessageEncrypted,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
          dispatchStartedAt: now,
          dispatchLeaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
        },
      });
      return { row, source, recipient, therapistMessage, destination, leased: true as const };
    })
    .catch((error: unknown) => {
      if (
        error instanceof ResendNotFound ||
        error instanceof ShareCapExceeded ||
        error instanceof RecipientReconfirmationRequired
      )
        return error;
      throw error;
    });
  if (attempt instanceof ResendNotFound)
    return privateJson({ error: 'Share not found' }, { status: 404 });
  if (attempt instanceof ShareCapExceeded)
    return privateJson({ error: 'Sharing limit reached' }, { status: 429 });
  if (attempt instanceof RecipientReconfirmationRequired)
    return privateJson(
      { error: 'Recipient confirmation must be renewed before resend.' },
      { status: 409 },
    );

  const { row, source, recipient, therapistMessage, destination } = attempt;
  const portalUrl = `${publicBaseUrl().replace(/\/$/, '')}/p/${row.shareToken}`;
  if (!attempt.leased) {
    return privateJson({
      channel: row.channel,
      shareId: row.id,
      status: row.status,
      portalUrl,
      errorCode: row.errorCode,
      errorDetail: null,
    });
  }

  let status: PatientShareStatus = 'SENT';
  let providerMessageId: string | null = null;
  let errorCode: string | null = null;
  try {
    if (source.channel === 'WHATSAPP' && !config.whatsappReady) {
      status = 'PERMANENT_FAILURE';
      errorCode = 'CHANNEL_NOT_CONFIGURED';
    } else if (source.channel === 'EMAIL' && !config.emailReady) {
      status = 'PERMANENT_FAILURE';
      errorCode = 'CHANNEL_NOT_CONFIGURED';
    } else if (source.channel !== 'PORTAL_LINK' && !destination) {
      status = 'PERMANENT_FAILURE';
      errorCode = source.channel === 'WHATSAPP' ? 'NO_CONTACT_PHONE' : 'NO_CONTACT_EMAIL';
    } else if (source.channel !== 'PORTAL_LINK') {
      const result = await sendViaChannel({
        channel: source.channel,
        toContact: destination!,
        clientFirstName: recipient.clientFirstName,
        therapistMessage: therapistMessage.value ?? undefined,
        subject: source.subject,
        snapshot: source.snapshot as unknown as PatientShareSnapshot,
        portalUrl,
        language: source.language as never,
        providerIdempotencyKey: row.id,
      });
      const classified = classifyShareDelivery(result);
      status = classified.status as PatientShareStatus;
      providerMessageId = result.providerMessageId ?? null;
      errorCode = classified.errorCode;
    }
  } catch {
    status = 'TRANSIENT_FAILURE';
    errorCode = 'AMBIGUOUS_DELIVERY_NOT_RETRIED';
  }
  const updated = await prisma.$transaction(async (tx) => {
    await lockShareFamily(tx, source);
    const finalized = await tx.patientShare.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: {
        status,
        providerMessageId,
        errorCode,
        ...(status === 'SENT' ? { sentAt: new Date() } : {}),
      },
    });
    if (finalized.count === 0) {
      const current = await tx.patientShare.findUnique({ where: { id: row.id } });
      if (!current) throw new ResendNotFound();
      return current;
    }
    if (status === 'SENT') {
      await tx.patientShare.updateMany({
        where: { id: source.id, status: { not: 'REVOKED' } },
        data: { refreshRequestedAt: null },
      });
    }
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PATIENT_ARTEFACT_SHARED',
        targetType: 'PatientShare',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: row.clientId,
          resentFromShareId: source.id,
          channel: row.channel,
          outcome: status,
        },
      },
      tx,
    );
    return (await tx.patientShare.findUnique({ where: { id: row.id } }))!;
  });
  return privateJson({
    channel: updated.channel,
    shareId: updated.id,
    status: updated.status,
    portalUrl,
    errorCode,
    errorDetail: null,
  });
}

class ResendNotFound extends Error {}
class ShareCapExceeded extends Error {}
class RecipientReconfirmationRequired extends Error {}

async function decryptTherapistMessage(
  psychologistId: string,
  encrypted: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!encrypted) return { ok: false };
  const plaintext = await decryptForTenant(psychologistId, encrypted);
  if (!plaintext) return { ok: false };
  try {
    const value = JSON.parse(plaintext) as { version?: unknown; value?: unknown };
    if (value.version !== 1 || (value.value !== null && typeof value.value !== 'string')) {
      return { ok: false };
    }
    return { ok: true, value: value.value as string | null };
  } catch {
    return { ok: false };
  }
}
