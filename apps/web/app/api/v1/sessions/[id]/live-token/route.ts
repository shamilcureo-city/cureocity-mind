import { NextResponse, type NextRequest } from 'next/server';
import type { SessionConsentSnapshot } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { signLiveToken } from '@/lib/live-token';
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
    select: { psychologistId: true, status: true, consentSnapshot: true },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (session.status === 'SCHEDULED') {
    const needsSnapshot = session.consentSnapshot === null;
    const ackedAt = new Date().toISOString();
    const snapshot: SessionConsentSnapshot = {
      entries: LIVE_CONSENT_SCOPES.map((scope) => ({
        scope,
        scriptVersion: 'v1.0',
        ackedAt,
      })),
      notes: 'Acknowledged at live consult start',
    };
    await prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: sessionId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
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
  return NextResponse.json({ token, expiresInSec });
}
