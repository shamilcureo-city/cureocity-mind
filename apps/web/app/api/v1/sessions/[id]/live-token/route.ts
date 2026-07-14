import { NextResponse, type NextRequest } from 'next/server';
import type { SessionConsentSnapshot } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { signLiveToken } from '@/lib/live-token';
import { fetchActiveMedications } from '@/lib/patient-context';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sprint DV8 hardening → DS11.1 — POST /api/v1/sessions/:id/live-token
 *
 * Mint a short-lived token the browser presents to the live gateway, so
 * the standalone socket service can prove the caller is the authenticated
 * practitioner who owns this session. Tenant-checked.
 *
 * DS11.1 (session lifecycle truth): this call IS the live consult's
 * capture-start, so it now carries the same lifecycle side effects the
 * batch /consent + /start pair has. A SCHEDULED session transitions to
 * IN_PROGRESS with a consent snapshot (the scribe scopes the patient
 * granted at creation, re-acknowledged at consult start) — making the
 * clinic queue statuses truthful and unblocking the sign route (which
 * requires COMPLETED, set by /live-note). Reconnects (already
 * IN_PROGRESS) just mint; a COMPLETED session is never regressed.
 */

/** The DPDP scopes the scribe pipeline runs under (parity with batch). */
const LIVE_CONSENT_SCOPES = [
  'AUDIO_RECORDING',
  'AI_NOTE_GENERATION',
  'CROSS_BORDER_PROCESSING',
] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true, status: true, consentSnapshot: true, clientId: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status === 'SCHEDULED') {
    const needsSnapshot = session.consentSnapshot === null;
    // PROD5 (DPDP) — this route used to STAMP all three scopes onto the
    // session unconditionally, fabricating a cross-border ack the patient
    // may never have given. Now: a fresh snapshot is only written when the
    // patient's STANDING consents actually cover the scribe scopes, and a
    // pre-recorded snapshot must itself carry the cross-border scope.
    if (needsSnapshot) {
      const standing = await prisma.consent.findMany({
        where: {
          clientId: session.clientId,
          scope: { in: [...LIVE_CONSENT_SCOPES] },
          status: 'GRANTED',
          withdrawnAt: null,
        },
        select: { scope: true },
      });
      const grantedSet = new Set(standing.map((c) => c.scope));
      const missing = LIVE_CONSENT_SCOPES.filter((s) => !grantedSet.has(s));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error:
              `The patient's consents on record do not cover the live scribe ` +
              `(missing: ${missing.join(', ')}). Capture the missing consent on the ` +
              `patient's record before starting a live consult — AI analysis processes ` +
              `the transcript outside India.`,
          },
          { status: 409 },
        );
      }
    } else {
      const priorScopes = new Set(
        ((session.consentSnapshot as { entries?: Array<{ scope?: string }> }).entries ?? []).map(
          (e) => e.scope,
        ),
      );
      if (!priorScopes.has('CROSS_BORDER_PROCESSING')) {
        return NextResponse.json(
          {
            error:
              'This session was consented without cross-border processing, which the live ' +
              'scribe requires (AI analysis processes the transcript outside India). Capture ' +
              'that consent before starting a live consult.',
          },
          { status: 409 },
        );
      }
    }
    const ackedAt = new Date().toISOString();
    const snapshot: SessionConsentSnapshot = {
      entries: LIVE_CONSENT_SCOPES.map((scope) => ({
        scope,
        scriptVersion: 'v1.0',
        ackedAt,
      })),
      notes: 'Standing consents re-acknowledged at live consult start',
    };
    await prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: sessionId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          // DS11.3 — record the capture pipeline on the row.
          captureMode: 'LIVE',
          ...(needsSnapshot && { consentSnapshot: snapshot }),
        },
      });
      if (needsSnapshot) {
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'SESSION_CONSENT_RECORDED',
            targetType: 'Session',
            targetId: sessionId,
            metadata: {
              ...auditMetadataFromRequest(req),
              scopes: [...LIVE_CONSENT_SCOPES],
              scriptVersion: 'v1.0',
              source: 'LIVE',
            },
          },
          tx,
        );
      }
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_STARTED',
          targetType: 'Session',
          targetId: sessionId,
          metadata: { ...auditMetadataFromRequest(req), source: 'LIVE' },
        },
        tx,
      );
    });
  }

  const { token, expiresInSec } = signLiveToken({
    sessionId,
    psychologistId: auth.value.psychologistId,
  });

  // DOC-3 — hand the browser the patient's confirmed active meds so it can
  // seed the live CaseState. The gateway's drug-interaction engine then sees
  // the standing regimen (a prior warfarin) against anything prescribed today
  // (ibuprofen) — the cross-visit safety check the "{age}-only" context missed.
  const activeMeds = await fetchActiveMedications(session.clientId, {
    excludeSessionId: sessionId,
  });

  return NextResponse.json({
    token,
    expiresInSec,
    patientContext: { activeMeds },
  });
}
