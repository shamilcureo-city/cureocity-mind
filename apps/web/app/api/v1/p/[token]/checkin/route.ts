import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  CheckinSubmitInputSchema,
  InstrumentCheckinSnapshotSchema,
  PatientShareTokenSchema,
  ClinicalLocaleSchema,
  type ClinicalLocale,
} from '@cureocity/contracts';
import { INSTRUMENTS, InstrumentScoringError, scoreInstrument } from '@cureocity/clinical';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

/**
 * POST /api/v1/p/[token]/checkin — Sprint 47.
 *
 * Public (no auth): the share token IS the authentication, same trust
 * model as the /p/<token> portal page. The client submits their
 * PHQ-9 / GAD-7 answers; we score deterministically and store an
 * InstrumentResponse tagged SELF so it joins the same trend the
 * in-session runner feeds.
 *
 * Safety: when the suicidality item (PHQ-9 #9) is endorsed we also
 * raise CRISIS_FLAG_RAISED so the therapist's crisis pathway picks it
 * up. The portal itself shows crisis resources to the client the
 * instant they endorse that item — a clinician isn't in the room.
 *
 * Idempotent-ish: a check-in can only be submitted once; re-posting
 * returns 409 so a double-tap or refresh can't create duplicate rows.
 */
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const tokenParse = PatientShareTokenSchema.safeParse(raw);
  if (!tokenParse.success) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 404 });
  }

  const share = await prisma.patientShare.findUnique({
    where: { shareToken: tokenParse.data },
    select: {
      id: true,
      clientId: true,
      psychologistId: true,
      artefactType: true,
      snapshot: true,
      language: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!share || share.artefactType !== 'INSTRUMENT_CHECKIN') {
    return NextResponse.json({ error: 'Check-in not found' }, { status: 404 });
  }
  if (share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'This check-in link has expired.' }, { status: 410 });
  }

  const snapParse = InstrumentCheckinSnapshotSchema.safeParse(share.snapshot);
  if (!snapParse.success) {
    return NextResponse.json({ error: 'Check-in could not be loaded.' }, { status: 422 });
  }
  const snapshot = snapParse.data;
  if (snapshot.completed) {
    return NextResponse.json(
      { error: 'This check-in has already been submitted.' },
      { status: 409 },
    );
  }

  const body = await parseJson(req, CheckinSubmitInputSchema);
  if (!body.ok) return body.response;

  const def = INSTRUMENTS[snapshot.instrumentKey];
  if (!def) {
    return NextResponse.json({ error: 'Unknown instrument' }, { status: 422 });
  }
  const language: ClinicalLocale = ClinicalLocaleSchema.safeParse(share.language).success
    ? (share.language as ClinicalLocale)
    : 'en';

  let scored;
  try {
    scored = scoreInstrument(def, body.value.responses, language);
  } catch (e) {
    if (e instanceof InstrumentScoringError) {
      return NextResponse.json({ error: e.message }, { status: 422 });
    }
    throw e;
  }

  const now = new Date();
  const meta = auditMetadataFromRequest(req);

  await prisma.$transaction(async (tx) => {
    const row = await tx.instrumentResponse.create({
      data: {
        clientId: share.clientId,
        psychologistId: share.psychologistId,
        instrumentKey: def.key,
        language,
        responses: body.value.responses as unknown as Prisma.InputJsonValue,
        score: scored.score,
        severity: scored.severityKey,
        administeredAt: now,
        // No clinician administered it; attribute to the owning
        // therapist (who sent it) but mark the mode SELF.
        administeredByPsychologistId: share.psychologistId,
        administrationMode: 'SELF',
      },
    });

    // Mark the share completed so re-opening shows a thank-you, not a
    // blank form, and the in-session "already sent" UI can tell.
    const completedSnapshot = { ...snapshot, completed: true, completedAt: now.toISOString() };
    await tx.patientShare.update({
      where: { id: share.id },
      data: {
        snapshot: completedSnapshot as unknown as Prisma.InputJsonValue,
        ...(share.status === 'SENT' ? { status: 'OPENED', openedAt: now } : {}),
      },
    });

    await writeAudit(
      {
        actorType: 'CLIENT',
        action: 'PATIENT_CHECKIN_SUBMITTED',
        targetType: 'InstrumentResponse',
        targetId: row.id,
        metadata: {
          ...meta,
          clientId: share.clientId,
          psychologistId: share.psychologistId,
          instrumentKey: def.key,
          score: scored.score,
          severity: scored.severityKey,
          riskFlagged: scored.riskFlagged,
        },
      },
      tx,
    );

    // Safety net — a self-harm endorsement on a remote check-in must
    // reach the therapist's crisis pathway, not sit silently in a trend.
    if (scored.riskFlagged) {
      await writeAudit(
        {
          actorType: 'CLIENT',
          action: 'CRISIS_FLAG_RAISED',
          targetType: 'InstrumentResponse',
          targetId: row.id,
          metadata: {
            ...meta,
            clientId: share.clientId,
            psychologistId: share.psychologistId,
            source: 'self_checkin',
            instrumentKey: def.key,
            score: scored.score,
          },
        },
        tx,
      );
    }
  });

  // Minimal response — no score / severity echoed back to the client.
  // riskFlagged lets the portal keep crisis resources on the thank-you.
  return NextResponse.json({ ok: true, riskFlagged: scored.riskFlagged });
}
