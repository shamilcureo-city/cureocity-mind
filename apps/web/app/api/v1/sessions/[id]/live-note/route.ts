import { NextResponse, type NextRequest } from 'next/server';
import {
  LiveNoteInputSchema,
  type ClinicalOrderV1,
  type MedicalEncounterNoteV1,
  type MedicationOrderV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { persistDraftedOrders, persistVitalReadings } from '@/lib/note-orchestrator';
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

  const parsed = await parseJson(req, LiveNoteInputSchema);
  if (!parsed.ok) return parsed.response;
  // The schema's `.default([])`s mean the validated value is fully
  // populated at runtime; narrow to the output types the helpers expect.
  const note = parsed.value.note as MedicalEncounterNoteV1;
  const medications = (parsed.value.medications ?? []) as MedicationOrderV1[];
  const orders = (parsed.value.orders ?? []) as ClinicalOrderV1[];
  // Sprint DS5 — the finalized Rx pad, stored alongside the note.
  const rxPad = parsed.value.rxPad
    ? (parsed.value.rxPad as unknown as Prisma.InputJsonValue)
    : undefined;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      clientId: true,
      scheduledAt: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.psychologist.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'Live encounter notes are for the doctor vertical only.' },
      { status: 409 },
    );
  }

  // Persist the note as a COMPLETED draft. The transcript was streamed
  // (not stored); a marker keeps presence-checks happy. The doctor signs
  // it from the encounter workspace — that signature is the attestation.
  const draft = await prisma.noteDraft.upsert({
    where: { sessionId },
    update: {
      status: 'COMPLETED',
      content: note as unknown as Prisma.InputJsonValue,
      riskSeverity: 'NONE',
      errorMessage: null,
      ...(rxPad !== undefined && { rxPad }),
    },
    create: {
      sessionId,
      status: 'COMPLETED',
      content: note as unknown as Prisma.InputJsonValue,
      riskSeverity: 'NONE',
      transcript: '(captured via live copilot)',
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
