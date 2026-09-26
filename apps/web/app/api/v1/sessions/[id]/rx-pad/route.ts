import { NextResponse, type NextRequest } from 'next/server';
import {
  RxPadDraftSchema,
  RxPadPatchInputSchema,
  type RxMedRow,
  type RxPadDraft,
  type RxPadPatchOp,
  type RxPadResponse,
} from '@cureocity/contracts';
import { allergyWarningsByDrug, interactionWarningsByDrug } from '@cureocity/clinical';
import type { Prisma } from '@prisma/client';
import { requireCapability } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { lockActiveClientForSession } from '@/lib/phi-write-lock';
import { canonicalJson } from '@/lib/sign-note-payload';
import { scribeErrorResponse } from '@/lib/scribe-workspace-auth';

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
  const auth = await requireCapability(req, 'PRESCRIPTION_DRAFTING');
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
  const auth = await requireCapability(req, 'PRESCRIPTION_DRAFTING');
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
  const draftId = session.noteDraft.id;

  let pad: RxPadDraft;
  try {
    pad = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "note_drafts" WHERE "sessionId" = ${sessionId} FOR UPDATE`;
      const current = await loadSession(sessionId, tx);
      if (
        !current ||
        current.psychologistId !== auth.value.psychologistId ||
        !current.noteDraft ||
        current.noteDraft.id !== draftId
      ) {
        throw new RxPadPatchError(409, 'The encounter draft changed. Reload before editing.');
      }
      if (current.therapyNote?.signedAt != null) {
        throw new RxPadPatchError(
          409,
          'This note is signed — the prescription can no longer be edited.',
        );
      }
      const original = parsePad(current.noteDraft.rxPad);
      if (
        parsed.value.expectedPad !== undefined &&
        canonicalJson(original) !== canonicalJson(parsed.value.expectedPad)
      ) {
        throw new RxPadPatchError(
          409,
          'The prescription changed in another window. Reload and preview your changes again.',
        );
      }
      let updated: RxPadDraft = original ?? { version: 'V1' };
      for (const op of parsed.value.ops) updated = applyOp(updated, op);
      updated = withSafetyWarnings(updated);
      await tx.noteDraft.update({
        where: { id: draftId },
        data: { rxPad: updated as unknown as Prisma.InputJsonValue },
      });

      const baseMetadata = auditMetadataFromRequest(req);
      for (const op of parsed.value.ops) {
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'RX_PAD_EDITED',
            targetType: 'NoteDraft',
            targetId: draftId,
            metadata: {
              ...baseMetadata,
              sessionId,
              op: op.op,
              ...('source' in op ? { source: op.source } : {}),
              item: itemLabel(op),
            },
          },
          tx,
        );
      }
      return updated;
    });
  } catch (error) {
    if (error instanceof RxPadPatchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return scribeErrorResponse(error);
  }

  const body: RxPadResponse = { rxPad: pad, signed: false };
  return NextResponse.json(body);
}

// ---------------------------------------------------------------------------

async function loadSession(
  sessionId: string,
  db: Pick<Prisma.TransactionClient, 'session'> = prisma,
) {
  return db.session.findUnique({
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

class RxPadPatchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
        // DS12 — a voice change / undo restore of a carried-forward med
        // keeps its 'continued' badge; plain adds stay false.
        continued: op.med.continued ?? false,
        // The adopt / manual-add tap IS the prescribing decision.
        status: 'confirmed',
        warnings: [],
        source: op.source,
      };
      return { ...pad, meds: [...meds, row] };
    }
    case 'removeMed':
      return { ...pad, meds: meds.filter((m) => !eq(m.drug, op.drug)) };
    case 'updateMed': {
      const existing = meds.find((m) => eq(m.drug, op.drug));
      if (!existing)
        throw new RxPadPatchError(404, `Medicine “${op.drug}” is no longer on the pad.`);
      if (!eq(op.drug, op.med.drug) && meds.some((m) => eq(m.drug, op.med.drug))) {
        throw new RxPadPatchError(409, `Medicine “${op.med.drug}” is already on the pad.`);
      }
      return {
        ...pad,
        meds: meds.map((m) =>
          eq(m.drug, op.drug)
            ? {
                ...m,
                ...op.med,
                // These fields are server/history owned and cannot be forged
                // by a browser edit.
                continued: m.continued,
                status: m.status,
                warnings: [],
                source: m.source,
                utteranceId: m.utteranceId,
                previous: m.previous,
              }
            : m,
        ),
      };
    }
    case 'confirmMed':
      return {
        ...pad,
        meds: meds.map((m) => (eq(m.drug, op.drug) ? { ...m, status: 'confirmed' } : m)),
      };
    // Sprint DS12 — the inverse of confirmMed. Lets the voice-edit Undo
    // restore a removed PENDING row without silently prescribing it.
    case 'unconfirmMed':
      return {
        ...pad,
        meds: meds.map((m) => (eq(m.drug, op.drug) ? { ...m, status: 'pending' } : m)),
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
/**
 * Recompute every safety warning on the pad, server-side, from scratch. The
 * client can never write its own warnings.
 *
 * Batch B — two changes here:
 *
 *  1. ALLERGIES are now checked. The pad has always carried the patient's
 *     allergy list and printed it on the slip, but nothing compared it to
 *     what was being prescribed — a penicillin-allergic patient could be
 *     handed amoxicillin with "Penicillin" printed at the top of the page.
 *  2. Interaction warnings are attributed by INDEX (`interactionWarningsByDrug`)
 *     instead of substring-matching the canonical generic against the row
 *     text. The old match missed every brand name — "Ecosprin" never matched
 *     "Aspirin", so the row that caused the interaction carried no warning.
 */
function withSafetyWarnings(pad: RxPadDraft): RxPadDraft {
  const meds = pad.meds ?? [];
  if (meds.length === 0) return pad;
  const drugs = meds.map((m) => m.drug);
  const interactions = interactionWarningsByDrug(drugs);
  const allergyLines = allergyWarningsByDrug(drugs, pad.allergies ?? []);
  const cleared = meds.map((m, i) => ({
    ...m,
    // Allergy first — it is the one that stops a prescription.
    warnings: [...(allergyLines[i] ?? []), ...(interactions[i] ?? [])],
  }));
  return { ...pad, meds: cleared };
}

/** A short human label for the audit metadata. */
function itemLabel(op: RxPadPatchOp): string {
  switch (op.op) {
    case 'addMed':
      return op.med.drug;
    case 'removeMed':
    case 'updateMed':
    case 'confirmMed':
    case 'unconfirmMed':
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
