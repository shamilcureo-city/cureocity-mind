import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export async function redactClientAuditMetadata(
  tx: Prisma.TransactionClient,
  clientId: string,
  sessionIds: readonly string[],
  erasureRequestId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string; metadata: Prisma.JsonValue | null }>>`
    SELECT "id", "metadata"
    FROM "audit_logs"
    WHERE "targetId" = ${clientId}
       OR "metadata" ->> 'clientId' = ${clientId}
       OR "metadata" ->> 'onBehalfOf' = ${clientId}
       OR "metadata" ->> 'sessionId' IN (${Prisma.join(sessionIds.length > 0 ? sessionIds : [''])})
  `;
  for (const row of rows) {
    const metadataHashHex = sha256(JSON.stringify(row.metadata ?? null));
    await tx.auditLog.update({
      where: { id: row.id },
      data: {
        metadata: {
          retentionClass: 'SECURITY_AND_DSR_PROOF',
          metadataHashHex,
          redactedForErasureRequestId: erasureRequestId,
        },
      },
    });
  }
}

async function hashAndClearErasureNarratives(
  tx: Prisma.TransactionClient,
  clientId: string,
): Promise<void> {
  const requests = await tx.clientErasureRequest.findMany({
    where: { clientId },
    select: { id: true, reason: true, resolutionNotes: true },
  });
  for (const request of requests) {
    await tx.clientErasureRequest.update({
      where: { id: request.id },
      data: {
        reason: null,
        reasonHashHex: request.reason ? sha256(request.reason) : undefined,
        resolutionNotes: null,
        resolutionNotesHashHex: request.resolutionNotes
          ? sha256(request.resolutionNotes)
          : undefined,
      },
    });
  }
}

export async function eraseClientPhi(
  tx: Prisma.TransactionClient,
  args: {
    clientId: string;
    erasureRequestId: string;
    psychologistId: string;
    now: Date;
  },
): Promise<void> {
  const { clientId, erasureRequestId, psychologistId, now } = args;

  // Terminal marker first while the caller holds FOR UPDATE on this Client.
  await tx.client.update({
    where: { id: clientId },
    data: {
      deletedAt: now,
      clientFirebaseUid: null,
      dateOfBirth: null,
      contactPhoneEncrypted: null,
      contactEmailEncrypted: null,
      fullNameEncrypted: null,
      presentingConcerns: null,
      preferredModality: null,
      allergies: [],
      carriedQuestions: Prisma.DbNull,
      abhaAddress: null,
      preferredLanguage: 'und',
      spokenLanguages: [],
    },
  });

  await tx.$executeRaw`
    SELECT redact_client_signed_note_phi(${erasureRequestId}, ${psychologistId})
  `;

  const sessions = await tx.session.findMany({ where: { clientId }, select: { id: true } });
  const sessionIds = sessions.map(({ id }) => id);
  const notes = await tx.therapyNote.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { id: true },
  });
  const therapyNoteIds = notes.map(({ id }) => id);
  const chunks = await tx.audioChunk.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { s3Key: true },
  });

  if (chunks.length > 0) {
    await tx.erasureObjectDeletionTask.createMany({
      data: chunks.map(({ s3Key }) => ({
        erasureRequestId,
        storageProvider: 'S3',
        objectKey: s3Key,
        objectKeyHashHex: sha256(s3Key),
      })),
      skipDuplicates: true,
    });
  }

  await redactClientAuditMetadata(tx, clientId, sessionIds, erasureRequestId);
  await hashAndClearErasureNarratives(tx, clientId);

  // FK leaves before parents. Signed notes/versions and their required draft +
  // session parents are retained only as redacted attestation proof.
  await tx.noteReview.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.liveConsultMetric.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.sessionProblemLink.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.noteEdit.deleteMany({ where: { therapyNoteId: { in: therapyNoteIds } } });
  await tx.transcriptSegment.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.audioChunk.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.geminiCallLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.medicationOrder.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.clinicalOrder.deleteMany({ where: { sessionId: { in: sessionIds } } });
  await tx.differential.deleteMany({ where: { sessionId: { in: sessionIds } } });

  await tx.treatmentGoalProgress.deleteMany({
    where: { plan: { clientId } },
  });
  await tx.modalityTransition.deleteMany({ where: { state: { clientId } } });
  await tx.emdrTarget.deleteMany({ where: { state: { clientId } } });

  await tx.patientShare.deleteMany({ where: { clientId } });
  await tx.therapyScript.deleteMany({ where: { clientId } });
  await tx.preSessionBrief.deleteMany({ where: { clientId } });
  await tx.caseConsult.deleteMany({ where: { clientId } });
  await tx.clientConceptualMap.deleteMany({ where: { clientId } });
  await tx.instrumentResponse.deleteMany({ where: { clientId } });
  await tx.safetyPlan.deleteMany({ where: { clientId } });
  await tx.exerciseAssignment.deleteMany({ where: { clientId } });
  await tx.moodLog.deleteMany({ where: { clientId } });
  await tx.journalEntry.deleteMany({ where: { clientId } });
  await tx.assessmentItem.deleteMany({ where: { clientId } });
  await tx.sessionAgreement.deleteMany({ where: { clientId } });
  await tx.clinicalReading.deleteMany({ where: { clientId } });
  await tx.caseFormulation.deleteMany({ where: { clientId } });
  await tx.letter.deleteMany({ where: { clientId } });
  await tx.problemListItem.deleteMany({ where: { clientId } });
  await tx.treatmentPlan.deleteMany({ where: { clientId } });
  await tx.clientDiagnosis.deleteMany({ where: { clientId } });
  await tx.clinicalReport.deleteMany({ where: { clientId } });
  await tx.treatmentEpisode.deleteMany({ where: { clientId } });
  await tx.modalityState.deleteMany({ where: { clientId } });
  await tx.clientNomination.deleteMany({ where: { clientId } });
  await tx.clientGrievance.deleteMany({ where: { clientId } });
  await tx.clientPushSubscription.deleteMany({ where: { clientId } });
  await tx.clientClaimToken.deleteMany({ where: { clientId } });

  await tx.consent.updateMany({ where: { clientId }, data: { notes: null } });
  await tx.noteDraft.updateMany({
    where: { sessionId: { in: sessionIds } },
    data: {
      transcriptEncrypted: null,
      speakerSegments: Prisma.DbNull,
      affectFeatures: Prisma.DbNull,
      content: Prisma.DbNull,
      rxPad: Prisma.DbNull,
      errorMessage: null,
    },
  });
  await tx.session.updateMany({
    where: { id: { in: sessionIds } },
    data: {
      modality: null,
      captureMode: null,
      phaseSnapshot: Prisma.DbNull,
      consentSnapshot: Prisma.DbNull,
      language: 'und',
      spokenLanguages: [],
      allianceRating: null,
    },
  });
  await tx.appointment.updateMany({
    where: { OR: [{ clientId }, { sessionId: { in: sessionIds } }] },
    data: {
      patientNameEncrypted: 'redacted',
      patientPhoneEncrypted: 'redacted',
      patientEmailEncrypted: null,
      concernEncrypted: null,
      clientId: null,
      sessionId: null,
    },
  });
}
