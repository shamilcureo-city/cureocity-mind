import { NextResponse, type NextRequest } from 'next/server';
import {
  LiveNoteInputSchema,
  TherapyLiveNoteInputSchema,
  type ClinicalOrderV1,
  type MedicalEncounterNoteV1,
  type MedicationOrderV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { persistDraftedOrders, persistVitalReadings } from '@/lib/note-orchestrator';
import { encryptForTenant } from '@/lib/tenant-crypto';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Sprint TS1 — therapist live scribe: persist the TherapyNoteV1 / IntakeNoteV1
  // as a COMPLETED NoteDraft (no meds / orders / vitals). Same provenance as the
  // batch therapist path; the therapist signs it from the workspace.
  if (session.psychologist.vertical === 'THERAPIST') {
    const parsedT = await parseJson(req, TherapyLiveNoteInputSchema);
    if (!parsedT.ok) return parsedT.response;
    const tnote = parsedT.value.note;
    const tTranscript = parsedT.value.transcript?.trim() ?? '';
    const tTranscriptText = tTranscript.length > 0 ? tTranscript : '(captured via live scribe)';
    let tTranscriptEncrypted: string | null = null;
    if (tTranscript.length > 0) {
      try {
        tTranscriptEncrypted = await encryptForTenant(auth.value.psychologistId, tTranscriptText);
      } catch (e) {
        console.warn(
          `[live-note] therapist transcript encryption failed for session=${sessionId}; storing plaintext only: ${(e as Error).message}`,
        );
      }
    }
    const tWrite =
      tTranscript.length > 0
        ? { transcript: tTranscriptText, transcriptEncrypted: tTranscriptEncrypted }
        : {};
    const tDraft = await prisma.noteDraft.upsert({
      where: { sessionId },
      update: {
        status: 'COMPLETED',
        content: tnote as unknown as Prisma.InputJsonValue,
        riskSeverity: 'NONE',
        errorMessage: null,
        ...tWrite,
      },
      create: {
        sessionId,
        status: 'COMPLETED',
        content: tnote as unknown as Prisma.InputJsonValue,
        riskSeverity: 'NONE',
        transcript: tTranscriptText,
        transcriptEncrypted: tTranscriptEncrypted,
      },
    });
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'NOTE_DRAFT_CREATED',
      targetType: 'NoteDraft',
      targetId: tDraft.id,
      metadata: {
        sessionId,
        source: 'LIVE',
        kind: parsedT.value.kind,
        ...auditMetadataFromRequest(req),
      },
    });
    if (session.status !== 'COMPLETED') {
      await prisma.$transaction(async (tx) => {
        await tx.session.update({
          where: { id: sessionId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'SESSION_ENDED',
            targetType: 'Session',
            targetId: sessionId,
            metadata: { ...auditMetadataFromRequest(req), source: 'LIVE' },
          },
          tx,
        );
      });
    }
    return NextResponse.json({ draftId: tDraft.id, status: 'COMPLETED' }, { status: 201 });
  }

  // Doctor path — parse the medical live-note body + narrow. Behavior unchanged.
  const parsed = await parseJson(req, LiveNoteInputSchema);
  if (!parsed.ok) return parsed.response;
  // The schema's `.default([])`s mean the validated value is fully
  // populated at runtime; narrow to the output types the helpers expect.
  const note = parsed.value.note as MedicalEncounterNoteV1;
  const medications = (parsed.value.medications ?? []) as MedicationOrderV1[];
  const orders = (parsed.value.orders ?? []) as ClinicalOrderV1[];
  // DOC-7 — the verbatim consult transcript the gateway streamed. Trim and
  // fall back to the presence marker when empty so a transcript-less consult
  // still satisfies the NoteDraft presence check.
  const transcript = parsed.value.transcript?.trim() ?? '';
  // Sprint DS5 — the finalized Rx pad, stored alongside the note.
  const rxPad = parsed.value.rxPad
    ? (parsed.value.rxPad as unknown as Prisma.InputJsonValue)
    : undefined;

  // DOC-7 — the streamed transcript is the medico-legal source record behind
  // the note; persist it verbatim (with the presence marker as the fallback
  // when the client sent none). Dual-write the envelope-encrypted copy on the
  // same per-tenant DEK path as the batch note-orchestrator; a KMS hiccup must
  // never fail an otherwise-complete note, so we log + store plaintext only.
  const transcriptText = transcript.length > 0 ? transcript : '(captured via live copilot)';
  let transcriptEncrypted: string | null = null;
  if (transcript.length > 0) {
    try {
      transcriptEncrypted = await encryptForTenant(auth.value.psychologistId, transcriptText);
    } catch (e) {
      console.warn(
        `[live-note] transcript encryption failed for session=${sessionId}; storing plaintext only: ${(e as Error).message}`,
      );
    }
  }

  // Only overwrite a stored transcript when this request actually carried one,
  // so a re-POST without a transcript can't clobber a good record with the
  // marker.
  const transcriptWrite =
    transcript.length > 0 ? { transcript: transcriptText, transcriptEncrypted } : {};

  // Persist the note as a COMPLETED draft. The doctor signs it from the
  // encounter workspace — that signature is the attestation.
  const draft = await prisma.noteDraft.upsert({
    where: { sessionId },
    update: {
      status: 'COMPLETED',
      content: note as unknown as Prisma.InputJsonValue,
      riskSeverity: 'NONE',
      errorMessage: null,
      ...transcriptWrite,
      ...(rxPad !== undefined && { rxPad }),
    },
    create: {
      sessionId,
      status: 'COMPLETED',
      content: note as unknown as Prisma.InputJsonValue,
      riskSeverity: 'NONE',
      transcript: transcriptText,
      transcriptEncrypted,
      ...(rxPad !== undefined && { rxPad }),
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'ENCOUNTER_NOTE_DRAFTED',
    targetType: 'NoteDraft',
    targetId: draft.id,
    metadata: {
      sessionId,
      source: 'LIVE',
      medicationCount: medications.length,
      orderCount: orders.length,
      ...auditMetadataFromRequest(req),
    },
  });

  // DS11.1 — the live consult is over: mark the session COMPLETED so the
  // clinic queue shows DONE and the sign route (requires COMPLETED)
  // accepts the note. Batch parity with POST /sessions/:id/end.
  if (session.status !== 'COMPLETED') {
    await prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: sessionId },
        data: { status: 'COMPLETED', endedAt: new Date() },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_ENDED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: { ...auditMetadataFromRequest(req), source: 'LIVE' },
        },
        tx,
      );
    });
  }

  // Reuse the batch helpers: draft the Rx + clinical orders (interaction-
  // checked server-side) and capture vitals into the chronic series.
  await persistDraftedOrders(sessionId, auth.value.psychologistId, medications, orders);
  await persistVitalReadings(
    sessionId,
    session.clientId,
    auth.value.psychologistId,
    session.scheduledAt,
    note.vitals,
  );

  return NextResponse.json({ draftId: draft.id, status: 'COMPLETED' }, { status: 201 });
}
