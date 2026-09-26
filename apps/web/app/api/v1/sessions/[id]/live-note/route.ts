import { NextResponse, after, type NextRequest } from 'next/server';
import {
  LiveNoteInputSchema,
  TherapyLiveNoteInputSchema,
  containsTranscriptionArtifact,
  type ClinicalLocale,
  type ClinicalOrderV1,
  type IntakeNoteV1,
  type MedicalEncounterNoteV1,
  type MedicationOrderV1,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { ensureEnglishNote } from '@/lib/ensure-english-note';
import { mapRiskSeverity, recordCommittedNoteRisk, writeNoteRiskAudit } from '@/lib/note-risk';
import {
  persistDraftedOrders,
  persistVitalReadings,
  runClinicalAnalysis,
} from '@/lib/note-orchestrator';
import { coverTranscriptWithSegments } from '@/lib/transcribe-segment';

import { encryptForTenant } from '@/lib/tenant-crypto';
import {
  encodeSavedTranscript,
  matchingTranscriptSegments,
  TRANSCRIPTION_REVIEW_WARNING,
} from '@/lib/saved-transcript';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { assertScribeTeleconsultDraftPersistence } from '@/lib/scribe-teleconsult';
import { consentAuthorizationResponse } from '@/lib/consent-gate';
import {
  preserveScribeCaptureIntegrity,
  scribeCaptureIntegrity,
} from '@/lib/scribe-capture-integrity';
import type { Prisma } from '@prisma/client';
import {
  finalizeLiveSession,
  sessionConcurrentModificationResponse,
} from '@/lib/session-transition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Therapy clinical analysis may continue in after(); keep enough headroom for
// that background pass. Doctor differential reasoning is clinician-triggered.
export const maxDuration = 120;

/**
 * Sprint DV9 — POST /api/v1/sessions/:id/live-note
 *
 * Persist a live consult's finalized note as a COMPLETED NoteDraft (the
 * gateway can't write to the DB, so the browser relays it here). The note
 * is AI-drafted (real Pass 2 in the gateway) and becomes a DRAFT the
 * doctor reviews + signs — the same provenance as the batch path. Drafts
 * the Rx + clinical orders + vital readings too, so the live path reaches
 * full parity (sign / orders / share / FHIR). Doctor-only, tenant-checked.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  // Fetch the session first so we can branch on the vertical before parsing
  // (the therapist + doctor bodies are different shapes).
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      scheduledAt: true,
      status: true,
      mindDocumentationMode: true,
      language: true,
      kind: true,
      modality: true,
      client: { select: { presentingConcerns: true } },
      psychologist: { select: { vertical: true, specialty: true } },
      // Batch C — the signed-note guard needs to know whether a signature
      // already exists for this session.
      therapyNote: { select: { signedAt: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.mindDocumentationMode === 'MANUAL')
    return NextResponse.json(
      { error: 'This session is clinician-written. Live note ingestion is disabled.' },
      { status: 409 },
    );

  const documentationCapability =
    session.psychologist.vertical === 'DOCTOR'
      ? 'MEDICAL_DOCUMENTATION'
      : 'BEHAVIORAL_HEALTH_DOCUMENTATION';
  const documentationAuth = await requireCapability(req, documentationCapability, auth);
  if (!documentationAuth.ok) return documentationAuth.response;

  // Batch C — REFUSE to overwrite the draft behind a SIGNED note.
  //
  // This route upserts NoteDraft.content by sessionId with no regard for
  // whether the encounter was already signed. A late `final` from a stale
  // socket, a re-opened tab, a doctor pressing End twice, or the Batch A
  // salvage path firing after a signature would each silently replace the
  // clinical record a doctor had already attested to — and the signature's
  // payload hash would no longer match the stored draft. A signed encounter
  // is closed; corrections go through the post-sign revision path
  // (/note/edit), which versions them and records who changed what.
  if (session.therapyNote?.signedAt != null) {
    return NextResponse.json(
      {
        error:
          'This encounter is already signed — its note can no longer be replaced. ' +
          'Open the encounter to record a correction instead.',
      },
      { status: 409 },
    );
  }

  // Sprint TS1 — therapist live scribe: persist the TherapyNoteV1 / IntakeNoteV1
  // as a COMPLETED NoteDraft (no meds / orders / vitals). Same provenance as the
  // batch therapist path; the therapist signs it from the workspace.
  if (session.psychologist.vertical === 'THERAPIST') {
    const parsedT = await parseJson(req, TherapyLiveNoteInputSchema);
    if (!parsedT.ok) return parsedT.response;
    if (containsTranscriptionArtifact(JSON.stringify(parsedT.value))) {
      return NextResponse.json(
        {
          error:
            'The transcript or note contains invalid transcription text. Keep this session unsigned and review the captured words before saving.',
          code: 'TRANSCRIPTION_ARTIFACT',
        },
        { status: 422 },
      );
    }
    // TS-fix — guarantee the clinician's note is in English (best-effort; the
    // live gateway's Pass 2 can echo a Malayalam-dominant transcript's language).
    // The cast bridges Zod's input/output typing of the union — the parsed
    // value is already a valid TherapyNoteV1 / IntakeNoteV1 at runtime.
    const tnote = await ensureEnglishNote(
      parsedT.value.note as TherapyNoteV1 | IntakeNoteV1,
      parsedT.value.kind,
    );
    if (containsTranscriptionArtifact(JSON.stringify(tnote))) {
      return NextResponse.json(
        {
          error:
            'The note translation contains invalid generated text. Keep the session unsigned and retry after reviewing the captured words.',
          code: 'TRANSCRIPTION_ARTIFACT',
        },
        { status: 422 },
      );
    }
    const tTranscript = parsedT.value.transcript?.trim() ?? '';
    const speakerSegments = matchingTranscriptSegments(tTranscript, parsedT.value.utterances ?? []);
    const transcriptionWarning = parsedT.value.transcriptionWarning === true;
    // No transcript is different from a transcript that says so. Do not mint a
    // transport/status marker and persist it as clinical speech. When actual
    // words exist, encryption remains fail-closed before any note write.
    let tTranscriptEncrypted: string | null = null;
    if (tTranscript.length > 0) {
      try {
        tTranscriptEncrypted = await encryptForTenant(
          auth.value.psychologistId,
          encodeSavedTranscript(tTranscript, speakerSegments, transcriptionWarning),
        );
      } catch (e) {
        console.error(
          `[live-note] therapist transcript encryption failed for session=${sessionId}: ${(e as Error).message}`,
        );
        return NextResponse.json(
          {
            error:
              'Could not encrypt the transcript (encryption service unavailable). Nothing was saved — retry in a moment.',
          },
          { status: 503 },
        );
      }
    }
    const tWrite = tTranscriptEncrypted ? { transcriptEncrypted: tTranscriptEncrypted } : {};
    const riskSeverity = mapRiskSeverity(tnote.riskFlags.severity);
    let tDraft;
    try {
      tDraft = await prisma.$transaction(async (tx) => {
        await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
        return finalizeLiveSession(tx, {
          sessionId,
          endedAt: new Date(),
          persistDraft: async () => {
            const draft = await tx.noteDraft.upsert({
              where: { sessionId },
              update: {
                status: 'COMPLETED',
                content: tnote as unknown as Prisma.InputJsonValue,
                riskSeverity,
                errorMessage: transcriptionWarning ? TRANSCRIPTION_REVIEW_WARNING : null,
                ...tWrite,
              },
              create: {
                sessionId,
                status: 'COMPLETED',
                content: tnote as unknown as Prisma.InputJsonValue,
                riskSeverity,
                ...tWrite,
                errorMessage: transcriptionWarning ? TRANSCRIPTION_REVIEW_WARNING : null,
              },
            });
            await writeAudit(
              {
                actorType: 'PSYCHOLOGIST',
                actorPsychologistId: auth.value.psychologistId,
                action: 'NOTE_DRAFT_CREATED',
                targetType: 'NoteDraft',
                targetId: draft.id,
                metadata: {
                  sessionId,
                  source: 'LIVE',
                  kind: parsedT.value.kind,
                  riskSeverity,
                  ...auditMetadataFromRequest(req),
                },
              },
              tx,
            );
            await writeNoteRiskAudit(
              {
                sessionId,
                psychologistId: auth.value.psychologistId,
                clientId: session.clientId,
                riskFlags: tnote.riskFlags,
              },
              tx,
            );
            return draft;
          },
          writeLifecycleAudit: () =>
            writeAudit(
              {
                actorType: 'PSYCHOLOGIST',
                actorPsychologistId: auth.value.psychologistId,
                action: 'SESSION_ENDED',
                targetType: 'Session',
                targetId: sessionId,
                metadata: { ...auditMetadataFromRequest(req), source: 'LIVE' },
              },
              tx,
            ),
        });
      });
    } catch (error) {
      const response = sessionConcurrentModificationResponse(error);
      if (response) return response;
      throw error;
    }
    // The conditional live transition rejects replay before persistence. Emit
    // only after commit, never on an encryption/audit failure or lost transition.
    recordCommittedNoteRisk(riskSeverity);
    // The batch path schedules Pass 3 (the copilot reading) in generate-note's
    // after(); this branch never did, so every live session landed on a board
    // whose "generated automatically" promise was false — the therapist had to
    // discover the Generate button. Preserve actual finalized speaker segments;
    // only older clients without a matching timeline use unknown coverage.
    const p3Kind = session.kind;
    if (tTranscript.length > 0 && auth.value.user.capabilities?.includes('CLINICAL_ANALYSIS')) {
      const p3Transcript = tTranscript;
      after(async () => {
        try {
          await runClinicalAnalysis({
            sessionId,
            clientId: session.clientId,
            psychologistId: session.psychologistId,
            language: (session.language as ClinicalLocale | undefined) ?? 'en',
            kind: p3Kind,
            modality: session.modality,
            presentingConcerns: session.client.presentingConcerns,
            transcript: p3Transcript,
            speakerSegments: coverTranscriptWithSegments({
              transcript: p3Transcript,
              segments: speakerSegments,
              startMs: 0,
              endMs: 0,
            }),
            note: tnote as Parameters<typeof runClinicalAnalysis>[0]['note'],
          });
        } catch (e) {
          console.error(
            `[live-note] clinical analysis failed for session=${sessionId}: ${(e as Error).message}`,
          );
        }
      });
    }
    return NextResponse.json({ draftId: tDraft.id, status: 'COMPLETED' }, { status: 201 });
  }

  // Doctor path — parse the medical live-note body + narrow. Behavior unchanged.
  const parsed = await parseJson(req, LiveNoteInputSchema);
  if (!parsed.ok) return parsed.response;
  if (containsTranscriptionArtifact(JSON.stringify(parsed.value))) {
    return NextResponse.json(
      {
        error:
          'The transcript or note contains invalid transcription text. Review the captured words before saving.',
        code: 'TRANSCRIPTION_ARTIFACT',
      },
      { status: 422 },
    );
  }
  // The schema's `.default([])`s mean the validated value is fully
  // populated at runtime; narrow to the output types the helpers expect.
  const note = parsed.value.note as MedicalEncounterNoteV1;
  const capabilities = documentationAuth.value.user.capabilities;
  const medications = capabilities?.includes('PRESCRIPTION_DRAFTING')
    ? ((parsed.value.medications ?? []) as MedicationOrderV1[])
    : [];
  const orders = capabilities?.includes('CLINICAL_ORDERS')
    ? ((parsed.value.orders ?? []) as ClinicalOrderV1[])
    : [];
  // DOC-7 — the verbatim consult transcript the gateway streamed. Empty input
  // remains absent; a transport presence marker is not clinical speech.
  const transcript = parsed.value.transcript?.trim() ?? '';
  // Sprint DS5 — the finalized Rx pad, stored alongside the note.
  const rxPad =
    capabilities?.includes('PRESCRIPTION_DRAFTING') && parsed.value.rxPad
      ? (parsed.value.rxPad as unknown as Prisma.InputJsonValue)
      : undefined;

  // DOC-7 — when present, the streamed transcript is the medico-legal source
  // record behind the note and is encrypted on the same per-tenant DEK path as
  // batch. S-hardening: the plaintext column is gone, so encryption is required.
  // KMS outage 503s BEFORE anything persists when actual words exist. An
  // absent transcript remains absent instead of becoming a fake source marker.
  let transcriptEncrypted: string | null = null;
  if (transcript.length > 0) {
    try {
      transcriptEncrypted = await encryptForTenant(auth.value.psychologistId, transcript);
    } catch (e) {
      console.error(
        `[live-note] transcript encryption failed for session=${sessionId}: ${(e as Error).message}`,
      );
      return NextResponse.json(
        {
          error:
            'Could not encrypt the transcript (encryption service unavailable). Nothing was saved — retry in a moment.',
        },
        { status: 503 },
      );
    }
  }

  // Only overwrite a stored transcript when this request actually carried one,
  // so a re-POST without a transcript cannot clobber a good record.
  const transcriptWrite = transcriptEncrypted ? { transcriptEncrypted } : {};

  let draft;
  let teleconsultInterrupted = false;
  try {
    draft = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      teleconsultInterrupted = await assertScribeTeleconsultDraftPersistence(
        tx,
        sessionId,
        auth.value.psychologistId,
        parsed.value.captureIncomplete,
      );
      return finalizeLiveSession(tx, {
        sessionId,
        endedAt: new Date(),
        persistDraft: async () => {
          const previousDraft = await tx.noteDraft.findUnique({
            where: { sessionId },
            select: { errorMessage: true },
          });
          const errorMessage = preserveScribeCaptureIntegrity(
            previousDraft?.errorMessage,
            teleconsultInterrupted || parsed.value.captureIncomplete,
            teleconsultInterrupted ? 'capture_interrupted' : parsed.value.captureIncompleteReason,
          );
          const persisted = await tx.noteDraft.upsert({
            where: { sessionId },
            update: {
              status: 'COMPLETED',
              content: note as unknown as Prisma.InputJsonValue,
              riskSeverity: 'NONE',
              errorMessage,
              ...transcriptWrite,
              ...(rxPad !== undefined && { rxPad }),
            },
            create: {
              sessionId,
              status: 'COMPLETED',
              content: note as unknown as Prisma.InputJsonValue,
              riskSeverity: 'NONE',
              errorMessage,
              ...transcriptWrite,
              ...(rxPad !== undefined && { rxPad }),
            },
          });
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: auth.value.psychologistId,
              action: 'ENCOUNTER_NOTE_DRAFTED',
              targetType: 'NoteDraft',
              targetId: persisted.id,
              metadata: {
                sessionId,
                source: 'LIVE',
                captureIncomplete: scribeCaptureIntegrity(errorMessage).incomplete,
                ...(scribeCaptureIntegrity(errorMessage).reason && {
                  captureIncompleteReason: scribeCaptureIntegrity(errorMessage).reason,
                }),
                medicationCount: medications.length,
                orderCount: orders.length,
                ...auditMetadataFromRequest(req),
              },
            },
            tx,
          );
          return persisted;
        },
        writeLifecycleAudit: () =>
          writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: auth.value.psychologistId,
              action: 'SESSION_ENDED',
              targetType: 'Session',
              targetId: sessionId,
              metadata: { ...auditMetadataFromRequest(req), source: 'LIVE' },
            },
            tx,
          ),
      });
    });
  } catch (error) {
    const response =
      consentAuthorizationResponse(error) ?? sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }

  // Reuse the batch helpers: draft the Rx + clinical orders (interaction-
  // checked server-side) and capture vitals into the chronic series.
  if (
    !teleconsultInterrupted &&
    (capabilities?.includes('PRESCRIPTION_DRAFTING') || capabilities?.includes('CLINICAL_ORDERS'))
  ) {
    await persistDraftedOrders(sessionId, auth.value.psychologistId, medications, orders);
  }
  if (!teleconsultInterrupted && capabilities?.includes('CHRONIC_CARE')) {
    await persistVitalReadings(
      sessionId,
      session.clientId,
      auth.value.psychologistId,
      session.scheduledAt,
      note.vitals,
    );
  }

  return NextResponse.json({ draftId: draft.id, status: 'COMPLETED' }, { status: 201 });
}
