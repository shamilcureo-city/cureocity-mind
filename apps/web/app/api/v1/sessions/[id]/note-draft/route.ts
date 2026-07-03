import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  IntakeNoteV1Schema,
  TherapyNoteV1Schema,
  type IntakeNoteV1,
  type TherapyNoteV1,
} from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toNoteDraft } from '@/lib/mappers';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SaveDraftSchema = z.object({ note: z.unknown() });

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/sessions/:id/note-draft — surfaces the Pass 1 + Pass 2
 * output. 404 if the session belongs to another psychologist (cross-
 * tenant non-leak); 404 if the draft hasn't been created yet (the
 * /end route creates it).
 */
export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const draft = await prisma.noteDraft.findUnique({ where: { sessionId } });
  if (!draft) {
    return NextResponse.json({ error: 'Note draft not yet generated' }, { status: 404 });
  }

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: auth.value.psychologistId,
    action: 'NOTE_DRAFT_VIEWED',
    targetType: 'NoteDraft',
    targetId: draft.id,
    metadata: auditMetadataFromRequest(req),
  });
  // Sprint DS5-fu — expose whether a live-assembled Rx pad exists so the
  // encounter workspace can offer the prescription PDF + patient share.
  return NextResponse.json({ ...toNoteDraft(draft), hasRxPad: draft.rxPad != null });
}

/**
 * PUT /api/v1/sessions/:id/note-draft — save a therapist's manual edits to
 * the draft note. Pre-sign only (after sign-off, edits go through
 * POST /note/edit, which keeps an immutable revision trail). Kind-aware:
 * validates against IntakeNoteV1 / TherapyNoteV1. The risk severity and
 * (for treatment) the modality are force-preserved — the editor never
 * exposes them, and a manual save must not silently change a risk level.
 */
export async function PUT(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await ctx.params;
  const body = await parseJson(req, SaveDraftSchema);
  if (!body.ok) return body.response;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      psychologistId: true,
      kind: true,
      noteDraft: { select: { id: true, content: true, status: true } },
      therapyNote: { select: { id: true, locked: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  // Sprint 71 — a signed note is editable only after it's been re-opened
  // ("Edit note" → POST /note/unlock flips locked → false and syncs the
  // draft to the signed content). A LOCKED signed note rejects draft edits;
  // an UNLOCKED one accepts them so the unlock → edit → re-sign cycle works.
  if (session.therapyNote && session.therapyNote.locked) {
    return NextResponse.json(
      { error: 'Note is signed and locked. Re-open it with “Edit note” before editing.' },
      { status: 409 },
    );
  }
  if (!session.noteDraft || !session.noteDraft.content) {
    return NextResponse.json(
      { error: 'No draft to edit yet — generate the note first.' },
      {
        status: 404,
      },
    );
  }
  if (session.noteDraft.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: `Draft is in ${session.noteDraft.status} state. Wait for generation to complete.` },
      { status: 409 },
    );
  }

  const isIntake = session.kind === 'INTAKE';
  let validated: TherapyNoteV1 | IntakeNoteV1;
  if (isIntake) {
    const current = IntakeNoteV1Schema.parse(session.noteDraft.content);
    const parsed = IntakeNoteV1Schema.safeParse(body.value.note);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Edited intake note failed validation.' }, { status: 422 });
    }
    validated = IntakeNoteV1Schema.parse({
      ...parsed.data,
      riskFlags: { ...parsed.data.riskFlags, severity: current.riskFlags.severity },
    });
  } else {
    const currentParsed = TherapyNoteV1Schema.safeParse(session.noteDraft.content);
    if (!currentParsed.success) {
      return NextResponse.json(
        { error: 'Stored note failed schema validation; cannot edit.' },
        { status: 422 },
      );
    }
    const current = currentParsed.data;
    const parsed = TherapyNoteV1Schema.safeParse(body.value.note);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Edited note failed validation.' }, { status: 422 });
    }
    validated = TherapyNoteV1Schema.parse({
      ...parsed.data,
      modality: current.modality,
      riskFlags: { ...parsed.data.riskFlags, severity: current.riskFlags.severity },
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.noteDraft.update({
      where: { id: session.noteDraft!.id },
      data: { content: validated as unknown as object },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'NOTE_DRAFT_VIEWED',
        targetType: 'NoteDraft',
        targetId: session.noteDraft!.id,
        metadata: { ...auditMetadataFromRequest(req), op: 'edit' },
      },
      tx,
    );
  });

  return NextResponse.json({ note: validated, kind: isIntake ? 'INTAKE' : 'TREATMENT' });
}
