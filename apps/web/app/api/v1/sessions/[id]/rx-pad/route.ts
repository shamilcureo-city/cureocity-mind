import { NextResponse, type NextRequest } from 'next/server';
import {
  RxPadDraftSchema,
  RxPadPatchInputSchema,
  type RxMedRow,
  type RxPadDraft,
  type RxPadPatchOp,
  type RxPadResponse,
} from '@cureocity/contracts';
import { checkInteractions, formatInteraction } from '@cureocity/clinical';
import type { Prisma } from '@prisma/client';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DS10-B — the plan composer's persistence.
 *
 *   GET   /api/v1/sessions/:id/rx-pad — the current DRAFT pad + signed flag.
 *   PATCH /api/v1/sessions/:id/rx-pad — apply typed edits to the draft pad:
 *         adopt an AI suggestion, add manually, confirm a pending med,
 *         remove a row, set/clear follow-up.
 *
 * Safety model: the pad stays a DRAFT until the note is signed (the DS5-fu
 * sign route snapshots confirmed meds into TherapyNote.rxPad). Once signed,
 * the pad is read-only here (409). Adds are idempotent (a double-tapped
 * adopt is a no-op, never a duplicate row). Interaction warnings are
 * recomputed server-side after every med change — the client can never
 * write its own warnings. Every op lands one RX_PAD_EDITED audit row.
 * Doctor-vertical only, tenant-checked.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await loadSession(sessionId);
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const body: RxPadResponse = {
    rxPad: parsePad(session.noteDraft?.rxPad),
    signed: session.therapyNote?.signedAt != null,
  };
  return NextResponse.json(body);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;
  const parsed = await parseJson(req, RxPadPatchInputSchema);
  if (!parsed.ok) return parsed.response;

  const session = await loadSession(sessionId);
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (session.psychologist.vertical !== 'DOCTOR') {
    return NextResponse.json(
      { error: 'The prescription pad is for the doctor vertical only.' },
      { status: 409 },
    );
  }
  if (session.therapyNote?.signedAt != null) {
    return NextResponse.json(
      { error: 'This note is signed — the prescription can no longer be edited.' },
      { status: 409 },
    );
  }
  if (!session.noteDraft) {
    return NextResponse.json(
      { error: 'No encounter note yet — record or generate the note first.' },
      { status: 409 },
    );
  }

  let pad: RxPadDraft = parsePad(session.noteDraft.rxPad) ?? { version: 'V1' };
  for (const op of parsed.value.ops) {
    pad = applyOp(pad, op);
  }
  // Server-owned warnings: recompute across the whole pad after the edits.
  pad = withInteractionWarnings(pad);

  await prisma.noteDraft.update({
    where: { id: session.noteDraft.id },
    data: { rxPad: pad as unknown as Prisma.InputJsonValue },
  });

  const baseMetadata = auditMetadataFromRequest(req);
  for (const op of parsed.value.ops) {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: auth.value.psychologistId,
      action: 'RX_PAD_EDITED',
      targetType: 'NoteDraft',
      targetId: session.noteDraft.id,
      metadata: {
        ...baseMetadata,
        sessionId,
        op: op.op,
        ...('source' in op ? { source: op.source } : {}),
        item: itemLabel(op),
      },
    });
  }

  const body: RxPadResponse = { rxPad: pad, signed: false };
  return NextResponse.json(body);
}

// ---------------------------------------------------------------------------

async function loadSession(sessionId: string) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      psychologistId: true,
      psychologist: { select: { vertical: true } },
      noteDraft: { select: { id: true, rxPad: true } },
      therapyNote: { select: { signedAt: true } },
    },
  });
}

/** Defensive parse — bad stored JSON degrades to null, never a 500. */
function parsePad(value: unknown): RxPadDraft | null {
  if (value == null) return null;
  const parsed = RxPadDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const eq = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Apply one typed op. Adds are idempotent; removes are case-insensitive. */
function applyOp(pad: RxPadDraft, op: RxPadPatchOp): RxPadDraft {
  const meds = pad.meds ?? [];
  const investigations = pad.investigations ?? [];
  const adviceLines = pad.adviceLines ?? [];
  switch (op.op) {
    case 'addMed': {
      if (meds.some((m) => eq(m.drug, op.med.drug))) return pad; // idempotent adopt
      const row: RxMedRow = {
        ...op.med,
        continued: false,
        // The adopt / manual-add tap IS the prescribing decision.
        status: 'confirmed',
        warnings: [],
        source: op.source,
      };
      return { ...pad, meds: [...meds, row] };
    }
    case 'removeMed':
      return { ...pad, meds: meds.filter((m) => !eq(m.drug, op.drug)) };
    case 'confirmMed':
      return {
        ...pad,
        meds: meds.map((m) => (eq(m.drug, op.drug) ? { ...m, status: 'confirmed' } : m)),
      };
    case 'addInvestigation': {
      if (investigations.some((i) => eq(i.name, op.name))) return pad;
      return {
        ...pad,
        investigations: [
          ...investigations,
          {
            name: op.name,
            ...(op.rationale ? { rationale: op.rationale } : {}),
            source: op.source,
          },
        ],
      };
    }
    case 'removeInvestigation':
      return { ...pad, investigations: investigations.filter((i) => !eq(i.name, op.name)) };
    case 'addAdvice': {
      if (adviceLines.some((a) => eq(a, op.text))) return pad;
      return { ...pad, adviceLines: [...adviceLines, op.text] };
    }
    case 'removeAdvice':
      return { ...pad, adviceLines: adviceLines.filter((a) => !eq(a, op.text)) };
    case 'setFollowUp':
      return {
        ...pad,
        followUp: { when: op.when, ...(op.withWhat ? { withWhat: op.withWhat } : {}) },
      };
    case 'clearFollowUp': {
      const { followUp: _cleared, ...rest } = pad;
      return rest;
    }
  }
}

/**
 * Recompute deterministic interaction warnings across the whole pad —
 * each interaction's message is attached to both participating rows.
 */
function withInteractionWarnings(pad: RxPadDraft): RxPadDraft {
  const meds = pad.meds ?? [];
  if (meds.length === 0) return pad;
  const cleared = meds.map((m) => ({ ...m, warnings: [] as string[] }));
  for (const interaction of checkInteractions(cleared.map((m) => m.drug))) {
    const message = formatInteraction(interaction);
    for (const row of cleared) {
      const drug = row.drug.trim().toLowerCase();
      const a = interaction.drugA.toLowerCase();
      const b = interaction.drugB.toLowerCase();
      if (drug.includes(a) || a.includes(drug) || drug.includes(b) || b.includes(drug)) {
        if (!row.warnings.includes(message)) row.warnings.push(message);
      }
    }
  }
  return { ...pad, meds: cleared };
}

/** A short human label for the audit metadata. */
function itemLabel(op: RxPadPatchOp): string {
  switch (op.op) {
    case 'addMed':
      return op.med.drug;
    case 'removeMed':
    case 'confirmMed':
      return op.drug;
    case 'addInvestigation':
    case 'removeInvestigation':
      return op.name;
    case 'addAdvice':
    case 'removeAdvice':
      return op.text.slice(0, 80);
    case 'setFollowUp':
      return op.when;
    case 'clearFollowUp':
      return 'follow-up cleared';
  }
}
