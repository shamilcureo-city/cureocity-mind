import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import type {
  PatientShareArtefactType as PrismaArtefactType,
  PatientShareChannel as PrismaChannel,
  PatientShareStatus as PrismaStatus,
} from '@prisma/client';
import type { SendResult } from '@cureocity/notifications';
import {
  ClinicalLocaleSchema,
  PatientShareSnapshotSchema,
  ShareInputSchema,
  type ClinicalLocale,
  type PatientShareChannel,
  type PatientShareSnapshot,
  type ShareInput,
  type ShareResultEntry,
} from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { shareChannels } from '@/lib/share-channels';
import { buildSnapshot, SnapshotBuildError } from '@/lib/share-snapshots';
import { translateForShare } from '@/lib/share-translate';
import { WATERMARK_TAGLINE, watermarkUrl } from '@/lib/watermark';
import { toPatientShare } from '@/lib/clinical-mappers';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { publicBaseUrl } from '@/lib/appointment-links';
import { privateJson, privateResponse } from '@/lib/private-response';
import {
  decryptShareRecipientEnvelope,
  encryptShareRecipientEnvelope,
  type ShareRecipientEnvelopeV1,
} from '@/lib/share-recipient-envelope';
import { decryptForTenant, encryptForTenant } from '@/lib/tenant-crypto';
import { classifyShareDelivery } from '@/lib/sprint5-final-behavior';
import { shareArtefactAuthorizationPolicy } from '@/lib/share-artefact-authorization';
import {
  finalizeLeasedShare,
  lockClientShareDispatch,
  readWinningShareDispatch,
} from '@/lib/share-dispatch-safety';
import { parseSharesPerHourCap } from '@/lib/share-rate-cap';
import { canonicalJson } from '@/lib/sign-note-payload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Token expiry — patients can re-open the portal for this long. */
const SHARE_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// AUD1 — max shares a therapist can create per rolling hour (fan-out guard).
const SHARES_PER_HOUR_CAP = parseSharesPerHourCap(process.env['SHARES_PER_HOUR_CAP']);
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
const PENDING_RECOVERY_CUTOFF_MS = DISPATCH_LEASE_MS;
const SIGNED_NOTE_PREVIEW_TTL_MS = 5 * 60 * 1000;

interface SignedNoteVersionIdentity {
  therapyNoteId: string;
  sessionId: string;
  signedVersionHash: string;
}

interface SignedNoteConfirmationIdentity extends SignedNoteVersionIdentity {
  expiresAtMs: number;
}

interface LockedSignedNoteRow {
  id: string;
  sessionId: string;
  locked: boolean;
  version: string;
  content: Prisma.JsonValue;
  rxPad: Prisma.JsonValue | null;
  signedAt: Date;
  signedBy: string;
  signChallengeHashHex: string | null;
  signSignatureB64u: string | null;
}

class PreviewVersionConflict extends Error {}
class ShareTargetNotFound extends Error {}

/**
 * POST /api/v1/share
 *
 * Fans out one share request to N channels, producing one
 * PatientShare row per channel. Each row carries a snapshot of the
 * artefact body so the patient view is stable even if the source is
 * later edited or deleted.
 *
 * Side effects per channel:
 *   - WHATSAPP   → WATI sendTemplateMessage with a short copy +
 *                  portal URL; falls back to Noop in dev
 *   - EMAIL      → SendGrid with a subject + portal URL; falls back
 *                  to Noop in dev
 *   - PORTAL_LINK → no send; just creates the row + returns the URL
 *                  for the therapist to copy and share manually
 *
 * Every row writes PATIENT_ARTEFACT_SHARED with the channel + outcome.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireCapability(req, 'PATIENT_SHARING');
  if (!auth.ok) return privateResponse(auth.response);

  const body = await parseJson(req, ShareInputSchema);
  if (!body.ok) return privateResponse(body.response);
  const input: ShareInput = body.value;
  const artefactPolicy = shareArtefactAuthorizationPolicy(input.artefact.artefactType);
  const artefactAuth = await requireCapability(req, artefactPolicy.requiredCapabilities[1], auth);
  if (!artefactAuth.ok) return privateResponse(artefactAuth.response);
  if (artefactAuth.value.user.vertical !== artefactPolicy.vertical) {
    return privateJson({ error: 'Not found' }, { status: 404 });
  }
  const channels = dedup(input.channels);
  // Preserve caller identities exactly for replay safety. Legacy callers get
  // a cryptographically strong identity per authenticated request so distinct
  // intentional sends are never deterministically collapsed together.
  const requestIdempotencyKey = input.idempotencyKey ?? randomUUID();
  const requestPayloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        clientId: input.clientId,
        channels,
        therapistMessage: input.therapistMessage ?? null,
        language: input.language ?? null,
        artefact: input.artefact,
      }),
    )
    .digest('hex');

  // Resolve the durable batch before touching the mutable source. Replays and
  // missing-channel recovery use the first row's immutable snapshot/language.
  const replay = input.preview
    ? []
    : await resolveExistingShareBatch({
        psychologistId: auth.value.psychologistId,
        requestIdempotencyKey,
        requestPayloadHash,
      });
  if (replay === null) return idempotencyConflictResponse();

  const client = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: {
      id: true,
      psychologistId: true,
      fullNameEncrypted: true,
      contactPhoneEncrypted: true,
      contactEmailEncrypted: true,
      preferredLanguage: true,
      deletedAt: true,
    },
  });
  if (!client || client.psychologistId !== auth.value.psychologistId || client.deletedAt !== null) {
    return privateJson({ error: 'Client not found' }, { status: 404 });
  }
  // Read cutover — decrypt the name + contacts before
  // routing the outbound message / personalising it.
  const pii = await resolveClientPii(client);

  const immutableAnchor = replay[0];
  let therapistMessageEncrypted: string;
  if (immutableAnchor) {
    const parsedMessage = await decryptTherapistMessage(
      auth.value.psychologistId,
      immutableAnchor.therapistMessageEncrypted,
    );
    if (!parsedMessage.ok) return recipientReconfirmationRequiredResponse();
    therapistMessageEncrypted = immutableAnchor.therapistMessageEncrypted!;
  } else {
    therapistMessageEncrypted = await encryptTherapistMessage(
      auth.value.psychologistId,
      input.therapistMessage ?? null,
    );
  }
  const language: ClinicalLocale = immutableAnchor
    ? resolveLanguage(immutableAnchor.language as ClinicalLocale, immutableAnchor.language)
    : resolveLanguage(input.language, client.preferredLanguage);

  const signedNoteArtefact =
    input.artefact.artefactType === 'SIGNED_NOTE' ||
    input.artefact.artefactType === 'SIGNED_INTAKE_NOTE';
  const confirmedPreview = input.previewConfirmation
    ? await decryptPreviewConfirmation(
        auth.value.psychologistId,
        input.previewConfirmation,
        requestPayloadHash,
        input.artefact.artefactType,
        'sessionId' in input.artefact ? (input.artefact.sessionId ?? null) : null,
      )
    : null;
  if (input.previewConfirmation && !confirmedPreview) {
    return privateJson(
      { error: 'Preview confirmation is invalid, expired, or stale.' },
      { status: 409 },
    );
  }
  if (!input.preview && signedNoteArtefact && !immutableAnchor && !confirmedPreview) {
    return privateJson(
      { error: 'Review and confirm the exact signed note preview before sending.' },
      { status: 409 },
    );
  }

  // Bracket snapshot construction with signed-version reads. buildSnapshot has
  // its own Prisma read, so this detects any unlock/re-sign that races between
  // the clinical-content read and confirmation sealing.
  let previewSignedVersionBefore: SignedNoteVersionIdentity | null = null;
  if (input.preview && signedNoteArtefact && 'sessionId' in input.artefact) {
    const previewSessionId = input.artefact.sessionId;
    if (!previewSessionId) {
      return privateJson({ error: 'Signed note preview has no session.' }, { status: 409 });
    }
    const before = await findCurrentSignedNote(
      previewSessionId,
      client.id,
      auth.value.psychologistId,
    );
    if (!before || !before.locked) {
      return privateJson({ error: 'Signed note is no longer locked.' }, { status: 409 });
    }
    previewSignedVersionBefore = signedNoteIdentity(before);
  }

  // Build the artefact snapshot once; reused across channels.
  let snapshotResult = confirmedPreview
    ? {
        snapshot: confirmedPreview.snapshot,
        subject: confirmedPreview.subject,
        sessionId: confirmedPreview.sessionId,
      }
    : immutableAnchor
      ? {
          snapshot: immutableAnchor.snapshot as unknown as PatientShareSnapshot,
          subject: immutableAnchor.subject,
          sessionId: immutableAnchor.sessionId,
        }
      : null;
  if (!snapshotResult) {
    try {
      snapshotResult = await buildSnapshot({
        ref: input.artefact,
        clientId: client.id,
        psychologistId: auth.value.psychologistId,
        language,
      });
    } catch (e) {
      if (e instanceof SnapshotBuildError) {
        return privateJson({ error: e.message }, { status: 422 });
      }
      throw e;
    }
  }
  if (!snapshotResult) {
    return privateJson({ error: 'Artefact not found' }, { status: 404 });
  }

  const { snapshot, subject, sessionId } = snapshotResult;

  // Sprint 72 — translate the patient-facing note text into the client's
  // language for the shared copy, WITHOUT touching the signed record. The
  // therapist keeps their note in their working language; the client reads
  // it in theirs. Fail-safe (see translateForShare): a translation miss
  // leaves the original text, it never blocks the share.
  if (!immutableAnchor && !confirmedPreview) await translateSnapshotForClient(snapshot, language);

  // Dry-run. Seal the exact reviewed artifact. Signed notes additionally bind
  // the confirmation to the current locked signature version and a short
  // lifetime; confirmation never rebuilds or retranslates the reviewed copy.
  if (input.preview) {
    const snapshotDigest = snapshotDigestHex(snapshot);
    let signedNote: SignedNoteVersionIdentity | null = null;
    if (signedNoteArtefact && 'sessionId' in input.artefact) {
      const previewSessionId = input.artefact.sessionId;
      if (!previewSessionId) {
        return privateJson({ error: 'Signed note preview has no session.' }, { status: 409 });
      }
      const current = await findCurrentSignedNote(
        previewSessionId,
        client.id,
        auth.value.psychologistId,
      );
      if (!current || !current.locked) {
        return privateJson({ error: 'Signed note is no longer locked.' }, { status: 409 });
      }
      signedNote = signedNoteIdentity(current);
      if (
        !previewSignedVersionBefore ||
        signedNote.therapyNoteId !== previewSignedVersionBefore.therapyNoteId ||
        signedNote.sessionId !== previewSignedVersionBefore.sessionId ||
        signedNote.signedVersionHash !== previewSignedVersionBefore.signedVersionHash
      ) {
        return previewVersionConflictResponse();
      }
    }
    const now = new Date();
    const previewConfirmation = await encryptForTenant(
      auth.value.psychologistId,
      JSON.stringify({
        version: signedNote ? 2 : 1,
        requestPayloadHash,
        artefactType: input.artefact.artefactType,
        snapshotDigest,
        snapshot,
        subject,
        sessionId: sessionId ?? null,
        ...(signedNote && {
          therapyNoteId: signedNote.therapyNoteId,
          signedVersionHash: signedNote.signedVersionHash,
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + SIGNED_NOTE_PREVIEW_TTL_MS).toISOString(),
        }),
      }),
    );
    return privateJson({
      preview: true,
      language,
      snapshot,
      snapshotDigest,
      snapshotVersion: 1,
      previewConfirmation,
    });
  }

  const portalOrigin = publicBaseUrl().replace(/\/$/, '');
  const existingByChannel = new Map(replay.map((row) => [row.channel, row]));
  const shareBatchId =
    replay[0]?.shareBatchId ??
    createHash('sha256')
      .update(`${auth.value.psychologistId}:${requestIdempotencyKey}`)
      .digest('base64url');
  const missingFanout = channels.filter((channel) => !existingByChannel.has(channel)).length;
  if (immutableAnchor && missingFanout > 0) return recipientReconfirmationRequiredResponse();
  const reservation =
    missingFanout > 0
      ? await reserveShareCapacity(auth.value.psychologistId, shareBatchId, missingFanout)
      : undefined;
  if (missingFanout > 0 && !reservation) {
    return privateJson(
      { error: 'Sharing limit reached for this hour — try again a little later.' },
      { status: 429 },
    );
  }

  // Reserve the complete missing fanout before creating therapy-script
  // homework. A rejected share must have no assignment/share/audit effects.
  if (
    input.artefact.artefactType === 'THERAPY_SCRIPT' &&
    snapshot.kind === 'THERAPY_SCRIPT' &&
    (input.artefact.assignHomework ?? true)
  ) {
    const therapyScriptId = input.artefact.therapyScriptId;
    let assignment: { id: string };
    try {
      assignment = await prisma.$transaction(async (tx) => {
        // Match assignment creation and erasure lock order: Client row first,
        // then narrower idempotency serialization. The locked read revalidates
        // lifecycle + tenant authority at the PHI persistence boundary.
        const lockedClients = await tx.$queryRaw<
          Array<{
            id: string;
            psychologistId: string;
            deletedAt: Date | null;
            status: 'ACTIVE' | 'PAUSED' | 'DISCHARGED' | 'TRANSFERRED';
          }>
        >`
          SELECT "id", "psychologistId", "deletedAt", "status"
          FROM "clients"
          WHERE "id" = ${client.id}
          FOR UPDATE
        `;
        const lockedClient = lockedClients[0];
        if (
          !lockedClient ||
          lockedClient.deletedAt !== null ||
          lockedClient.status !== 'ACTIVE' ||
          lockedClient.psychologistId !== auth.value.psychologistId
        ) {
          throw new ShareTargetNotFound();
        }

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${therapyScriptId}))`;
        const existing = await tx.exerciseAssignment.findFirst({
          where: {
            clientId: client.id,
            sourceTherapyScriptId: therapyScriptId,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
          orderBy: { assignedAt: 'desc' },
          select: { id: true },
        });
        if (existing) return existing;
        const created = await tx.exerciseAssignment.create({
          data: {
            clientId: client.id,
            psychologistId: auth.value.psychologistId,
            exerciseId: null,
            source: 'THERAPY_SCRIPT',
            sourceTherapyScriptId: therapyScriptId,
            customDescription: snapshot.homework.description,
            status: 'PENDING',
          },
          select: { id: true },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'EXERCISE_ASSIGNED',
            targetType: 'ExerciseAssignment',
            targetId: created.id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId: client.id,
              source: 'THERAPY_SCRIPT',
              sourceTherapyScriptId: therapyScriptId,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      if (error instanceof ShareTargetNotFound) {
        return privateJson({ error: 'Client not found' }, { status: 404 });
      }
      throw error;
    }
    // Every channel stores one shared assignment id, and idempotent replays
    // reuse the same open assignment instead of creating duplicates.
    snapshot.homeworkAssignmentId = assignment.id;
  }
  const channelResults: ShareResultEntry[] = [];
  // Sprint 43 — when the WATI / SendGrid env is unset the channel is
  // backed by a NoopBackend that reports "sent" without delivering.
  // Refuse those sends explicitly so the therapist sees a clear
  // "not configured" failure instead of a false success; PORTAL_LINK
  // always works and is the fallback.
  const channelConfig = shareChannels();

  const persistPreflightFailure = async (
    channel: PatientShareChannel,
    errorCode: string,
    recipientEnvelopeEncrypted: string,
  ): Promise<boolean> => {
    const now = new Date();
    let row;
    try {
      row = await prisma.$transaction(async (tx) => {
        if (confirmedPreview?.signedNote) {
          await assertCurrentSignedPreviewVersion(tx, confirmedPreview.signedNote, {
            clientId: client.id,
            psychologistId: auth.value.psychologistId,
          });
        }
        const failed = await tx.patientShare.create({
          data: {
            clientId: client.id,
            psychologistId: auth.value.psychologistId,
            sessionId: sessionId ?? null,
            shareBatchId,
            requestIdempotencyKey,
            requestPayloadHash,
            artefactType: input.artefact.artefactType as PrismaArtefactType,
            artefactId: extractArtefactId(input),
            channel: channel as PrismaChannel,
            status: 'PERMANENT_FAILURE',
            shareToken: generateShareToken(),
            language,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            subject,
            toContact: null,
            recipientEnvelopeEncrypted,
            therapistMessageEncrypted,
            errorCode,
            expiresAt: new Date(now.getTime() + SHARE_EXPIRY_MS),
          },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'PATIENT_ARTEFACT_SHARED',
            targetType: 'PatientShare',
            targetId: failed.id,
            metadata: {
              ...auditMetadataFromRequest(req),
              clientId: client.id,
              sessionId: sessionId ?? null,
              artefactType: input.artefact.artefactType,
              channel,
              outcome: 'permanent_failure',
              errorCode,
            },
          },
          tx,
        );
        for (const audit of specializedShareAudits({
          input,
          psychologistId: auth.value.psychologistId,
          clientId: client.id,
          channel,
          outcome: 'permanent_failure',
          rowId: failed.id,
          request: req,
          isPrimaryChannel: channel === channels[0],
        })) {
          await writeAudit(audit, tx);
        }
        return failed;
      });
    } catch (error) {
      if (error instanceof PreviewVersionConflict) return false;
      if (!isPrismaUniqueConstraintError(error)) throw error;
      row = await prisma.patientShare.findUnique({
        where: {
          psychologistId_requestIdempotencyKey_channel: {
            psychologistId: auth.value.psychologistId,
            requestIdempotencyKey,
            channel: channel as PrismaChannel,
          },
        },
      });
      if (!row || row.requestPayloadHash !== requestPayloadHash) {
        return false;
      }
    }
    channelResults.push({
      channel,
      shareId: row.id,
      status: 'PERMANENT_FAILURE',
      portalUrl: '',
      errorCode,
    });
    return true;
  };

  for (const channel of channels) {
    const existing = existingByChannel.get(channel as PrismaChannel);
    if (existing) {
      const trusted = await decryptShareRecipientEnvelope(
        auth.value.psychologistId,
        existing.recipientEnvelopeEncrypted,
        channel,
      );
      if (!trusted) return recipientReconfirmationRequiredResponse();
      channelResults.push({
        channel,
        shareId: existing.id,
        status: existing.status,
        portalUrl: `${portalOrigin}/p/${existing.shareToken}`,
        errorCode: existing.errorCode,
      });
      continue;
    }
    const recipientEnvelope: ShareRecipientEnvelopeV1 = {
      version: 1,
      channel,
      destination:
        channel === 'WHATSAPP' ? pii.contactPhone : channel === 'EMAIL' ? pii.contactEmail : null,
      clientFirstName: firstName(pii.fullName),
    };
    const recipientEnvelopeEncrypted = await encryptShareRecipientEnvelope(
      auth.value.psychologistId,
      recipientEnvelope,
    );
    const toContact = recipientEnvelope.destination;

    if (channel === 'WHATSAPP' && !channelConfig.whatsappReady) {
      if (
        !(await persistPreflightFailure(
          channel,
          'CHANNEL_NOT_CONFIGURED',
          recipientEnvelopeEncrypted,
        ))
      ) {
        return idempotencyConflictResponse();
      }
      continue;
    }
    if (channel === 'EMAIL' && !channelConfig.emailReady) {
      if (
        !(await persistPreflightFailure(
          channel,
          'CHANNEL_NOT_CONFIGURED',
          recipientEnvelopeEncrypted,
        ))
      ) {
        return idempotencyConflictResponse();
      }
      continue;
    }

    if (channel === 'WHATSAPP' && !toContact) {
      if (
        !(await persistPreflightFailure(channel, 'NO_CONTACT_PHONE', recipientEnvelopeEncrypted))
      ) {
        return idempotencyConflictResponse();
      }
      continue;
    }
    if (channel === 'EMAIL' && !toContact) {
      if (
        !(await persistPreflightFailure(channel, 'NO_CONTACT_EMAIL', recipientEnvelopeEncrypted))
      ) {
        return idempotencyConflictResponse();
      }
      continue;
    }

    const shareToken = generateShareToken();
    const artefactId = extractArtefactId(input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SHARE_EXPIRY_MS);

    let row;
    try {
      const createRow = (tx: Pick<Prisma.TransactionClient, 'patientShare'>) =>
        tx.patientShare.create({
          data: {
            clientId: client.id,
            psychologistId: auth.value.psychologistId,
            sessionId: sessionId ?? null,
            shareBatchId,
            requestIdempotencyKey,
            requestPayloadHash,
            artefactType: input.artefact.artefactType as PrismaArtefactType,
            artefactId,
            channel: channel as PrismaChannel,
            status: 'PENDING' as PrismaStatus,
            shareToken,
            language,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            subject,
            toContact: null,
            recipientEnvelopeEncrypted,
            therapistMessageEncrypted,
            expiresAt,
          },
        });
      row = confirmedPreview?.signedNote
        ? await prisma.$transaction(async (tx) => {
            await assertCurrentSignedPreviewVersion(tx, confirmedPreview.signedNote!, {
              clientId: client.id,
              psychologistId: auth.value.psychologistId,
            });
            return createRow(tx);
          })
        : await createRow(prisma);
    } catch (error) {
      if (error instanceof PreviewVersionConflict) return previewVersionConflictResponse();
      if (!isPrismaUniqueConstraintError(error)) throw error;
      row = await prisma.patientShare.findUnique({
        where: {
          psychologistId_requestIdempotencyKey_channel: {
            psychologistId: auth.value.psychologistId,
            requestIdempotencyKey,
            channel: channel as PrismaChannel,
          },
        },
      });
      if (!row || row.requestPayloadHash !== requestPayloadHash) {
        return privateJson(
          { error: 'Idempotency key was already used for another payload.' },
          { status: 409 },
        );
      }
    }
    const portalUrl = `${portalOrigin}/p/${row.shareToken}`;

    // A unique-create loser must discard request-local mutable values and use
    // only the immutable encrypted values persisted by the winning request.
    const persistedDispatch = await readWinningShareDispatch(row, {
      decryptRecipient: decryptShareRecipientEnvelope,
      decryptMessage: decryptTherapistMessage,
    });
    if (!persistedDispatch) {
      return recipientReconfirmationRequiredResponse();
    }

    const dispatchNow = new Date();
    const dispatchLeaseOwner = randomBytes(24).toString('base64url');
    const claim = await prisma.$transaction(async (tx) => {
      await lockClientShareDispatch(tx, client.id);
      const dispatchClient = await tx.client.findFirst({
        where: {
          id: client.id,
          psychologistId: auth.value.psychologistId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!dispatchClient) return { count: 0 };
      return tx.patientShare.updateMany({
        where: { id: row.id, status: 'PENDING', dispatchStartedAt: null },
        data: {
          dispatchStartedAt: dispatchNow,
          dispatchLeaseExpiresAt: new Date(dispatchNow.getTime() + DISPATCH_LEASE_MS),
          dispatchLeaseOwner,
          dispatchLeaseVersion: { increment: 1 },
        },
      });
    });
    if (claim.count !== 1) {
      const current = await prisma.patientShare.findUniqueOrThrow({ where: { id: row.id } });
      channelResults.push({
        channel,
        shareId: current.id,
        status: current.status,
        portalUrl,
        errorCode: current.errorCode,
      });
      continue;
    }

    const claimedRow = await prisma.patientShare.findUniqueOrThrow({ where: { id: row.id } });
    let sendResult: SendResult | { outcome: 'sent' } = { outcome: 'sent' };
    if (channel !== 'PORTAL_LINK') {
      try {
        sendResult = await sendViaChannel({
          channel,
          toContact: persistedDispatch.destination!,
          clientFirstName: persistedDispatch.clientFirstName,
          therapistMessage: persistedDispatch.therapistMessage,
          subject: persistedDispatch.subject,
          snapshot: persistedDispatch.snapshot,
          portalUrl,
          language: persistedDispatch.language as ClinicalLocale,
          providerIdempotencyKey: row.id,
        });
      } catch {
        sendResult = { outcome: 'transient_failure', errorCode: 'DELIVERY_EXCEPTION' };
      }
    }

    const classified = classifyShareDelivery({
      outcome: sendResult.outcome,
      errorCode: 'errorCode' in sendResult ? sendResult.errorCode : null,
    });
    const nextStatus = classified.status as PrismaStatus;
    const sendErrorCode = classified.errorCode;

    const providerMessageId =
      'providerMessageId' in sendResult ? (sendResult.providerMessageId ?? null) : null;

    const updated = await prisma.$transaction((tx) =>
      finalizeShareAttempt(tx, {
        rowId: row.id,
        dispatchLeaseOwner,
        dispatchLeaseVersion: claimedRow.dispatchLeaseVersion,
        nextStatus,
        sent: sendResult.outcome === 'sent',
        providerMessageId,
        errorCode: sendErrorCode,
        audit: {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'PATIENT_ARTEFACT_SHARED',
          targetType: 'PatientShare',
          targetId: row.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            clientId: client.id,
            sessionId: sessionId ?? null,
            artefactType: input.artefact.artefactType,
            channel,
            outcome: sendResult.outcome,
            providerMessageId,
            errorCode: sendErrorCode,
          },
        },
        additionalAudits: specializedShareAudits({
          input,
          psychologistId: auth.value.psychologistId,
          clientId: client.id,
          channel,
          outcome: sendResult.outcome,
          rowId: row.id,
          request: req,
          isPrimaryChannel: channel === channels[0],
        }),
      }),
    );

    channelResults.push({
      channel,
      shareId: updated.id,
      status: updated.status,
      portalUrl,
      errorCode: updated.errorCode,
    });
  }

  if (reservation?.ownerToken) {
    await finalizeShareCapacityReservation(
      auth.value.psychologistId,
      shareBatchId,
      reservation.ownerToken,
      channels.length,
    );
  }
  return privateJson({ results: channelResults });
}

// ============================================================================
// Channel send + message composition.
// ============================================================================

export interface SendArgs {
  channel: PatientShareChannel;
  toContact: string;
  clientFirstName: string;
  therapistMessage: string | undefined;
  subject: string;
  snapshot: PatientShareSnapshot;
  portalUrl: string;
  language: ClinicalLocale;
  providerIdempotencyKey: string;
}

export async function sendViaChannel(args: SendArgs): Promise<SendResult> {
  const channels = shareChannels();
  if (args.channel === 'WHATSAPP') {
    const templateName = process.env['WATI_TEMPLATE_PATIENT_SHARE'] ?? 'patient_share';
    return channels.messaging.sendWhatsApp({
      to: args.toContact,
      templateName,
      // Positional template params: 1=first name, 2=subject, 3=portal URL.
      // The WATI template must declare these; until production templates
      // are approved, the Noop backend captures the call as if sent.
      templateParams: [args.clientFirstName, args.subject, args.portalUrl],
      idempotencyKey: args.providerIdempotencyKey,
    });
  }
  if (args.channel === 'EMAIL') {
    const intro = args.therapistMessage?.trim();
    // Sprint 56 (Lever 3a) — append a UTM-tagged watermark so every
    // share is a brand touch to prospective therapists.
    const cmsUrl = watermarkUrl({ source: 'share_email', campaign: args.snapshot.kind });
    const bodyLines = [
      `Hi ${args.clientFirstName},`,
      '',
      intro ? `${intro}` : 'Your therapist has shared something with you.',
      '',
      `Open it here: ${args.portalUrl}`,
      '',
      'This link is private to you. It expires in 30 days.',
      '',
      '— Cureocity Mind',
      '',
      `${WATERMARK_TAGLINE} ${cmsUrl}`,
    ];
    return channels.email.sendEmail({
      to: args.toContact,
      subject: args.subject,
      textBody: bodyLines.join('\n'),
      idempotencyKey: args.providerIdempotencyKey,
      htmlBody: composeEmailHtml({
        clientFirstName: args.clientFirstName,
        intro: intro ?? null,
        subject: args.subject,
        portalUrl: args.portalUrl,
        watermarkUrl: cmsUrl,
      }),
    });
  }
  // PORTAL_LINK has no send action — handled by the caller.
  return { outcome: 'sent' };
}

function specializedShareAudits(args: {
  input: ShareInput;
  psychologistId: string;
  clientId: string;
  channel: PatientShareChannel;
  outcome: SendResult['outcome'];
  rowId: string;
  request: NextRequest;
  isPrimaryChannel: boolean;
}): Array<Parameters<typeof writeAudit>[0]> {
  const common = {
    actorType: 'PSYCHOLOGIST' as const,
    actorPsychologistId: args.psychologistId,
    targetType: 'PatientShare',
    targetId: args.rowId,
    metadata: {
      ...auditMetadataFromRequest(args.request),
      clientId: args.clientId,
      channel: args.channel,
      outcome: args.outcome,
    },
  };
  switch (args.input.artefact.artefactType) {
    case 'PROGRESS_REPORT':
      return [
        ...(args.isPrimaryChannel
          ? [
              {
                ...common,
                action: 'PATIENT_PROGRESS_REPORT_GENERATED' as const,
                targetType: 'Client',
                targetId: args.clientId,
              },
            ]
          : []),
        { ...common, action: 'PATIENT_PROGRESS_REPORT_SHARED' },
      ];
    case 'CHRONIC_PROGRESS_REPORT':
      return [{ ...common, action: 'PATIENT_CHRONIC_REPORT_SHARED' }];
    case 'RX_PAD':
      return [{ ...common, action: 'PATIENT_RX_PAD_SHARED' }];
    default:
      return [];
  }
}

function specializedReplayAudits(args: {
  artefactType: PrismaArtefactType;
  clientId: string;
  channel: PrismaChannel;
  outcome: SendResult['outcome'];
  rowId: string;
}): Array<Parameters<typeof writeAudit>[0]> {
  const common = {
    actorType: 'SYSTEM' as const,
    targetType: 'PatientShare',
    targetId: args.rowId,
    metadata: {
      clientId: args.clientId,
      channel: args.channel,
      outcome: args.outcome,
    },
  };
  switch (args.artefactType) {
    case 'PROGRESS_REPORT':
      return [{ ...common, action: 'PATIENT_PROGRESS_REPORT_SHARED' }];
    case 'CHRONIC_PROGRESS_REPORT':
      return [{ ...common, action: 'PATIENT_CHRONIC_REPORT_SHARED' }];
    case 'RX_PAD':
      return [{ ...common, action: 'PATIENT_RX_PAD_SHARED' }];
    default:
      return [];
  }
}

async function finalizeShareAttempt(
  tx: Prisma.TransactionClient,
  args: {
    rowId: string;
    dispatchLeaseOwner?: string;
    dispatchLeaseVersion?: number;
    nextStatus: PrismaStatus;
    sent: boolean;
    providerMessageId: string | null;
    errorCode: string | null;
    audit: Parameters<typeof writeAudit>[0];
    additionalAudits?: Array<Parameters<typeof writeAudit>[0]>;
  },
) {
  return finalizeLeasedShare(tx, {
    rowId: args.rowId,
    leaseOwner: args.dispatchLeaseOwner,
    leaseVersion: args.dispatchLeaseVersion,
    status: args.nextStatus,
    ...(args.sent && { sentAt: new Date() }),
    providerMessageId: args.providerMessageId,
    errorCode: args.errorCode,
    audit: async () => {
      await writeAudit(args.audit, tx);
      for (const audit of args.additionalAudits ?? []) await writeAudit(audit, tx);
    },
  });
}

function composeEmailHtml(args: {
  clientFirstName: string;
  intro: string | null;
  subject: string;
  portalUrl: string;
  watermarkUrl: string;
}): string {
  const introBlock = args.intro
    ? `<p style="margin:0 0 16px 0; color:#3c4858">${escapeHtml(args.intro)}</p>`
    : '';
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#1f2933; max-width:560px; margin:0 auto; padding:32px 24px;">
  <h1 style="font-size:18px; margin:0 0 16px 0;">${escapeHtml(args.subject)}</h1>
  <p style="margin:0 0 16px 0;">Hi ${escapeHtml(args.clientFirstName)},</p>
  ${introBlock}
  <p style="margin:0 0 24px 0;">Your therapist has shared something with you. Open it on a private page:</p>
  <p style="margin:0 0 32px 0;">
    <a href="${args.portalUrl}" style="display:inline-block; background:#1f2933; color:#fff; text-decoration:none; padding:10px 18px; border-radius:999px; font-weight:500;">Open the page</a>
  </p>
  <p style="margin:0 0 12px 0; font-size:12px; color:#7b8794;">This link is private to you and expires in 30 days.</p>
  <p style="margin:24px 0 0 0; padding-top:16px; border-top:1px solid #e6e9ed; font-size:11px; color:#7b8794;">
    <a href="${args.watermarkUrl}" style="color:#7b8794; text-decoration:none;">${escapeHtml(WATERMARK_TAGLINE)}</a>
  </p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Helpers.
// ============================================================================

async function resolveExistingShareBatch(args: {
  psychologistId: string;
  requestIdempotencyKey: string;
  requestPayloadHash: string;
}) {
  return prisma
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${args.psychologistId}:${args.requestIdempotencyKey}`}))`;
      const rows = await tx.patientShare.findMany({
        where: {
          psychologistId: args.psychologistId,
          requestIdempotencyKey: args.requestIdempotencyKey,
        },
        orderBy: { channel: 'asc' },
      });
      if (rows.some((row) => row.requestPayloadHash !== args.requestPayloadHash))
        throw new ShareIdempotencyConflict();
      const now = new Date();
      for (const row of rows) {
        if (row.status !== 'PENDING') continue;
        if (!row.dispatchStartedAt) {
          if (now.getTime() - row.createdAt.getTime() < PENDING_RECOVERY_CUTOFF_MS) continue;
          await tx.patientShare.delete({ where: { id: row.id } });
          continue;
        }
        if (row.dispatchLeaseExpiresAt && row.dispatchLeaseExpiresAt > now) continue;
        const portalDispatch = row.channel === 'PORTAL_LINK';
        await finalizeShareAttempt(tx, {
          rowId: row.id,
          nextStatus: portalDispatch ? 'SENT' : 'TRANSIENT_FAILURE',
          sent: portalDispatch,
          providerMessageId: null,
          errorCode: portalDispatch ? null : 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
          audit: {
            actorType: 'SYSTEM',
            action: 'PATIENT_ARTEFACT_SHARED',
            targetType: 'PatientShare',
            targetId: row.id,
            metadata: {
              clientId: row.clientId,
              channel: row.channel,
              outcome: portalDispatch ? 'sent' : 'transient_failure',
              errorCode: portalDispatch ? null : 'AMBIGUOUS_DELIVERY_NOT_RETRIED',
            },
          },
          additionalAudits: specializedReplayAudits({
            artefactType: row.artefactType,
            clientId: row.clientId,
            channel: row.channel,
            outcome: portalDispatch ? 'sent' : 'transient_failure',
            rowId: row.id,
          }),
        });
      }
      return tx.patientShare.findMany({
        where: {
          psychologistId: args.psychologistId,
          requestIdempotencyKey: args.requestIdempotencyKey,
        },
        orderBy: { channel: 'asc' },
      });
    })
    .catch((error: unknown) => {
      if (error instanceof ShareIdempotencyConflict) return null;
      throw error;
    });
}

async function reserveShareCapacity(
  psychologistId: string,
  shareBatchId: string,
  requestedFanout: number,
): Promise<{ ownerToken: string | null } | null> {
  const ownerToken = randomBytes(24).toString('base64url');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${psychologistId}))`;
    const now = new Date();
    const cutoff = new Date(now.getTime() - 60 * 60 * 1000);
    await tx.shareRateReservation.deleteMany({
      where: { psychologistId, expiresAt: { lte: now } },
    });
    const reservations = await tx.shareRateReservation.findMany({
      where: { psychologistId, createdAt: { gte: cutoff } },
      select: { shareBatchId: true, fanout: true },
    });
    const used = await tx.patientShare.count({
      where: {
        psychologistId,
        createdAt: { gte: cutoff },
        ...(reservations.length > 0 && {
          OR: [
            { shareBatchId: null },
            { shareBatchId: { notIn: reservations.map((item) => item.shareBatchId) } },
          ],
        }),
      },
    });
    const reserved = reservations.reduce((sum, item) => sum + item.fanout, 0);
    const existing = await tx.shareRateReservation.findUnique({ where: { shareBatchId } });
    if (existing) {
      return existing.psychologistId === psychologistId && existing.fanout === requestedFanout
        ? { ownerToken: null }
        : null;
    }
    if (used + reserved + requestedFanout > SHARES_PER_HOUR_CAP) return null;
    await tx.shareRateReservation.create({
      data: {
        psychologistId,
        shareBatchId,
        fanout: requestedFanout,
        ownerToken,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
      },
    });
    return { ownerToken };
  });
}

async function finalizeShareCapacityReservation(
  psychologistId: string,
  shareBatchId: string,
  ownerToken: string,
  expectedRows: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${psychologistId}))`;
    const created = await tx.patientShare.count({ where: { psychologistId, shareBatchId } });
    if (created < expectedRows) return;
    await tx.shareRateReservation.deleteMany({
      where: { psychologistId, shareBatchId, ownerToken },
    });
  });
}

/**
 * Translate the patient-facing text of a note snapshot into the client's
 * language, in place. Only the shared copy is affected — the signed note is
 * untouched. Other artefact kinds already localise via their own builders
 * (pre-translated instrument catalog, plain-language composers) or don't carry
 * free-text worth translating here.
 */
async function translateSnapshotForClient(
  snapshot: PatientShareSnapshot,
  language: ClinicalLocale,
): Promise<void> {
  if (language === 'en') return;
  if (snapshot.kind === 'SIGNED_NOTE') {
    const [subjective, objective, assessment, plan] = await translateForShare(
      [snapshot.subjective, snapshot.objective, snapshot.assessment, snapshot.plan],
      language,
    );
    snapshot.subjective = subjective ?? snapshot.subjective;
    snapshot.objective = objective ?? snapshot.objective;
    snapshot.assessment = assessment ?? snapshot.assessment;
    snapshot.plan = plan ?? snapshot.plan;
  } else if (snapshot.kind === 'SIGNED_INTAKE_NOTE') {
    // Translate each section's title + body together, preserving order.
    const flat = snapshot.sections.flatMap((s) => [s.title, s.body]);
    const translated = await translateForShare(flat, language);
    snapshot.sections = snapshot.sections.map((s, i) => ({
      ...s,
      title: translated[i * 2] ?? s.title,
      body: translated[i * 2 + 1] ?? s.body,
    }));
  }
}

function generateShareToken(): string {
  // 16 bytes → 22 base64url chars (matches ClientClaimToken convention).
  return randomBytes(16).toString('base64url');
}

function extractArtefactId(input: ShareInput): string {
  switch (input.artefact.artefactType) {
    case 'SIGNED_NOTE':
      return input.artefact.sessionId;
    case 'REFLECTION_QUESTIONS':
      // Reflection questions are not persisted; use the session id as
      // the artefact discriminator. The questions live in the snapshot.
      return input.artefact.sessionId;
    case 'THERAPY_SCRIPT':
      return input.artefact.therapyScriptId;
    case 'HOMEWORK':
      return input.artefact.assignmentId;
    case 'SESSION_TAKEAWAY':
      return input.artefact.sessionId;
    case 'TREATMENT_PLAN':
      return input.artefact.treatmentPlanId;
    case 'PROGRESS_REPORT':
      // Progress reports are derived from cumulative client state, not
      // a stored row — the clientId IS the artefact discriminator.
      return input.artefact.clientId;
    case 'INSTRUMENT_CHECKIN':
      // The check-in isn't a stored row either; key it by client +
      // instrument so the share history reads sensibly.
      return `${input.artefact.clientId}:${input.artefact.instrumentKey}`;
    case 'SIGNED_INTAKE_NOTE':
      // Sprint 49 — sessionId is the discriminator, same as SIGNED_NOTE.
      return input.artefact.sessionId;
    case 'AFTER_VISIT_SUMMARY':
      // Sprint DV3 — built from the signed encounter note; sessionId is
      // the discriminator, same posture as SIGNED_NOTE.
      return input.artefact.sessionId;
    case 'CHRONIC_PROGRESS_REPORT':
      // Sprint DV7 — derived from the per-patient reading series, not a
      // stored row; the clientId IS the artefact discriminator.
      return input.artefact.clientId;
    case 'RX_PAD':
      // Sprint DS5-fu — the signed prescription; sessionId is the
      // discriminator, same posture as SIGNED_NOTE / AFTER_VISIT_SUMMARY.
      return input.artefact.sessionId;
  }
}

function resolveLanguage(override: ClinicalLocale | undefined, preferred: string): ClinicalLocale {
  if (override) return override;
  const parsed = ClinicalLocaleSchema.safeParse(preferred);
  return parsed.success ? parsed.data : 'en';
}

function dedup<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of arr) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (trimmed.length === 0) return 'there';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

async function encryptTherapistMessage(psychologistId: string, value: string | null) {
  return encryptForTenant(psychologistId, JSON.stringify({ version: 1, value }));
}

async function decryptTherapistMessage(
  psychologistId: string,
  encrypted: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (!encrypted) return { ok: false };
  const plaintext = await decryptForTenant(psychologistId, encrypted);
  if (!plaintext) return { ok: false };
  try {
    const parsed = JSON.parse(plaintext) as { version?: unknown; value?: unknown };
    if (parsed.version !== 1 || (parsed.value !== null && typeof parsed.value !== 'string')) {
      return { ok: false };
    }
    return { ok: true, value: parsed.value as string | null };
  } catch {
    return { ok: false };
  }
}

function snapshotDigestHex(snapshot: PatientShareSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function signedNoteVersionHash(note: LockedSignedNoteRow): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        therapyNoteId: note.id,
        sessionId: note.sessionId,
        version: note.version,
        content: note.content,
        rxPad: note.rxPad,
        signedAt: new Date(note.signedAt).toISOString(),
        signedBy: note.signedBy,
        signChallengeHashHex: note.signChallengeHashHex,
        signSignatureB64u: note.signSignatureB64u,
      }),
    )
    .digest('hex');
}

function signedNoteIdentity(note: LockedSignedNoteRow): SignedNoteVersionIdentity {
  return {
    therapyNoteId: note.id,
    sessionId: note.sessionId,
    signedVersionHash: signedNoteVersionHash(note),
  };
}

async function findCurrentSignedNote(
  sessionId: string,
  clientId: string,
  psychologistId: string,
): Promise<LockedSignedNoteRow | null> {
  return prisma.therapyNote.findFirst({
    where: {
      sessionId,
      session: { clientId, psychologistId },
    },
    select: {
      id: true,
      sessionId: true,
      locked: true,
      version: true,
      content: true,
      rxPad: true,
      signedAt: true,
      signedBy: true,
      signChallengeHashHex: true,
      signSignatureB64u: true,
    },
  });
}

async function assertCurrentSignedPreviewVersion(
  tx: Prisma.TransactionClient,
  expected: SignedNoteConfirmationIdentity,
  owner: { clientId: string; psychologistId: string },
): Promise<void> {
  // The share lock conflicts with unlock/re-sign's FOR UPDATE. Validation and
  // PatientShare insertion run in the same transaction, so the signed source
  // cannot drift in the gap between comparison and snapshot persistence.
  const rows = await tx.$queryRaw<LockedSignedNoteRow[]>`
    SELECT tn."id", tn."sessionId", tn."locked", tn."version", tn."content", tn."rxPad",
           tn."signedAt", tn."signedBy", tn."signChallengeHashHex", tn."signSignatureB64u"
    FROM "therapy_notes" tn
    INNER JOIN "sessions" s ON s."id" = tn."sessionId"
    WHERE tn."id" = ${expected.therapyNoteId}
      AND tn."sessionId" = ${expected.sessionId}
      AND s."clientId" = ${owner.clientId}
      AND s."psychologistId" = ${owner.psychologistId}
    FOR SHARE OF tn
  `;
  const current = rows[0];
  if (
    Date.now() >= expected.expiresAtMs ||
    !current ||
    !current.locked ||
    signedNoteVersionHash(current) !== expected.signedVersionHash
  ) {
    throw new PreviewVersionConflict();
  }
}

async function decryptPreviewConfirmation(
  psychologistId: string,
  encrypted: string,
  requestPayloadHash: string,
  artefactType: string,
  expectedSessionId: string | null,
): Promise<{
  snapshot: PatientShareSnapshot;
  subject: string;
  sessionId: string | null;
  signedNote: SignedNoteConfirmationIdentity | null;
} | null> {
  const plaintext = await decryptForTenant(psychologistId, encrypted);
  if (!plaintext) return null;
  try {
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    const snapshot = PatientShareSnapshotSchema.safeParse(value['snapshot']);
    const sessionId = value['sessionId'];
    if (
      (value['version'] !== 1 && value['version'] !== 2) ||
      value['requestPayloadHash'] !== requestPayloadHash ||
      value['artefactType'] !== artefactType ||
      typeof value['subject'] !== 'string' ||
      (sessionId !== null && typeof sessionId !== 'string') ||
      sessionId !== expectedSessionId ||
      !snapshot.success ||
      value['snapshotDigest'] !== snapshotDigestHex(snapshot.data)
    )
      return null;

    const signedArtefact = artefactType === 'SIGNED_NOTE' || artefactType === 'SIGNED_INTAKE_NOTE';
    let signedNote: SignedNoteConfirmationIdentity | null = null;
    if (signedArtefact) {
      if (
        value['version'] !== 2 ||
        typeof value['therapyNoteId'] !== 'string' ||
        typeof value['signedVersionHash'] !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value['signedVersionHash']) ||
        typeof value['issuedAt'] !== 'string' ||
        typeof value['expiresAt'] !== 'string'
      )
        return null;
      const issuedAt = Date.parse(value['issuedAt']);
      const expiresAt = Date.parse(value['expiresAt']);
      const now = Date.now();
      if (
        !Number.isFinite(issuedAt) ||
        !Number.isFinite(expiresAt) ||
        issuedAt > now + 30_000 ||
        expiresAt <= now ||
        expiresAt <= issuedAt ||
        expiresAt - issuedAt > SIGNED_NOTE_PREVIEW_TTL_MS
      )
        return null;
      signedNote = {
        therapyNoteId: value['therapyNoteId'],
        sessionId: sessionId as string,
        signedVersionHash: value['signedVersionHash'],
        expiresAtMs: expiresAt,
      };
    }
    return {
      snapshot: snapshot.data,
      subject: value['subject'],
      sessionId: sessionId as string | null,
      signedNote,
    };
  } catch {
    return null;
  }
}

class ShareIdempotencyConflict extends Error {}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function idempotencyConflictResponse(): NextResponse {
  return privateJson(
    { error: 'Idempotency key was already used for another payload.' },
    { status: 409 },
  );
}

function previewVersionConflictResponse(): NextResponse {
  return privateJson(
    { error: 'Signed note changed after preview. Review the current locked version again.' },
    { status: 409 },
  );
}

function recipientReconfirmationRequiredResponse(): NextResponse {
  return privateJson(
    { error: 'Recipient confirmation must be renewed before this share can be sent.' },
    { status: 409 },
  );
}

// Re-export the mapper for callers that import from this route file
// (e.g. tests). Pure ergonomics.
export const __toPatientShare = toPatientShare;
export const __reserveShareCapacity = reserveShareCapacity;
export const __finalizeShareCapacityReservation = finalizeShareCapacityReservation;
