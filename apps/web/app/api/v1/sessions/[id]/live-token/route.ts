import { NextResponse, type NextRequest } from 'next/server';
import type { PractitionerCapability } from '@cureocity/contracts';
import { requireCapability, requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { signLiveToken } from '@/lib/live-token';
import { fetchActiveMedications, fetchAllergies } from '@/lib/patient-context';
import {
  assertValidScribeConsent,
  ConsentAuthorizationError,
  consentAuthorizationResponse,
  withClientConsentLock,
} from '@/lib/consent-gate';
import { prisma } from '@/lib/prisma';
import {
  assertLiveTokenSessionStatus,
  captureActivationTransitionData,
  conditionalSessionTransition,
  sessionConcurrentModificationResponse,
} from '@/lib/session-transition';

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
 * batch /consent + /start pair has. A SCHEDULED session with a complete,
 * currently-backed consent snapshot transitions to IN_PROGRESS — making the
 * clinic queue statuses truthful and unblocking the sign route (which
 * requires COMPLETED, set by /live-note). Reconnects (already
 * IN_PROGRESS) just mint; a COMPLETED session is never regressed.
 */

const LIVE_SCOPED_CAPABILITIES = new Set<PractitionerCapability>([
  'LIVE_ENCOUNTER',
  'BEHAVIORAL_HEALTH_DOCUMENTATION',
  'MEDICAL_DOCUMENTATION',
  'CLINICAL_ANALYSIS',
  'PRESCRIPTION_DRAFTING',
  'CLINICAL_ORDERS',
  'CHRONIC_CARE',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: sessionId } = await params;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      psychologistId: true,
      status: true,
      consentSnapshot: true,
      clientId: true,
      psychologist: { select: { vertical: true } },
    },
  });
  if (!session || session.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // This mint is the regulated execution/disclosure boundary, including on a
  // reconnect. Route guards re-query current grants and own the audited 403.
  const liveAuth = await requireCapability(req, 'LIVE_ENCOUNTER', auth);
  if (!liveAuth.ok) return liveAuth.response;
  const documentationCapability: PractitionerCapability =
    session.psychologist.vertical === 'DOCTOR'
      ? 'MEDICAL_DOCUMENTATION'
      : 'BEHAVIORAL_HEALTH_DOCUMENTATION';
  const documentationAuth = await requireCapability(req, documentationCapability, liveAuth);
  if (!documentationAuth.ok) return documentationAuth.response;
  const capabilities = (documentationAuth.value.user.capabilities ?? []).filter((capability) =>
    LIVE_SCOPED_CAPABILITIES.has(capability),
  );

  let tokenResult: ReturnType<typeof signLiveToken>;
  try {
    tokenResult = await prisma.$transaction((tx) =>
      withClientConsentLock(tx, session.clientId, async () => {
        const current = await tx.session.findUnique({
          where: { id: sessionId },
          select: { status: true, consentSnapshot: true },
        });
        if (!current) throw new ConsentAuthorizationError('Session changed during authorization');
        assertLiveTokenSessionStatus(current.status);

        await assertValidScribeConsent(current.consentSnapshot, session.clientId, tx);

        if (current.status === 'SCHEDULED') {
          // Scribe keeps its established token-is-start contract. Mind mints a
          // preflight token without changing lifecycle state; its browser posts
          // /start only after the microphone worklet is actively capturing.
          const transition = captureActivationTransitionData(
            session.psychologist.vertical,
            'LIVE',
            false,
          );
          if (transition) {
            await conditionalSessionTransition(tx, {
              sessionId,
              expectedStatus: 'SCHEDULED',
              data: transition,
            });
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
          }
        }

        return signLiveToken({
          sessionId,
          psychologistId: auth.value.psychologistId,
          vertical: session.psychologist.vertical,
          capabilities,
        });
      }),
    );
  } catch (error) {
    const response =
      consentAuthorizationResponse(error) ?? sessionConcurrentModificationResponse(error);
    if (response) return response;
    throw error;
  }

  const { token, expiresInSec } = tokenResult;

  // DOC-3 — hand the browser the patient's confirmed active meds so it can
  // seed the live CaseState. The gateway's drug-interaction engine then sees
  // the standing regimen (a prior warfarin) against anything prescribed today
  // (ibuprofen) — the cross-visit safety check the "{age}-only" context missed.
  // Batch B — the allergy list rides along too. `PatientContext.allergies` has
  // existed since DS1 and the Rx pad has always printed it, but nothing ever
  // filled it: the live consult's allergy check had no data to check against.
  const patientContext = capabilities.includes('PRESCRIPTION_DRAFTING')
    ? await Promise.all([
        fetchActiveMedications(session.clientId, { excludeSessionId: sessionId }),
        fetchAllergies(session.clientId),
      ]).then(([activeMeds, allergies]) => ({ activeMeds, allergies }))
    : undefined;

  return NextResponse.json({
    token,
    expiresInSec,
    capabilities,
    ...(patientContext ? { patientContext } : {}),
  });
}
