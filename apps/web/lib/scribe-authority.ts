import type { SessionStatus } from '@prisma/client';
import { SCRIBE_CONSENT_SCOPES } from './consent-gate';
import { assertAuditedSessionCapabilities } from './capabilities';
import { writeAudit } from './audit';
import { prisma } from './prisma';

export type ScribeAuthorityDenialReason = 'CLIENT' | 'CONSENT' | 'SESSION_STATE';

export class ScribeAuthorityError extends Error {
  constructor(readonly reason: ScribeAuthorityDenialReason) {
    super('Current scribe authority is not available');
    this.name = 'ScribeAuthorityError';
  }
}

export type ScribeAuthoritySource =
  | 'transcribeChunkBeforeModel'
  | 'transcribeChunkBeforePersistence'
  | 'transcribeChunkBackstopBeforeModel'
  | 'transcribeChunkBackstopBeforePersistence'
  | 'pass1BeforeModel'
  | 'pass1BeforePersistence'
  | 'pass2BeforeModel'
  | 'pass2BeforePersistence'
  | 'noteTranslationBeforeModel'
  | 'legacyPass1BeforeModel'
  | 'legacyPass1BeforePersistence'
  | 'clinicalAnalysisBeforeModel'
  | 'clinicalAnalysisBeforePersistence'
  | 'differentialBeforeModel'
  | 'differentialBeforePersistence'
  | 'planDictationPass1BeforeModel'
  | 'planDictationPass1BeforePersistence'
  | 'planDictationPass14BeforeModel'
  | 'planDictationPass14BeforePersistence';

type ActiveScribeSessionStatus = Extract<SessionStatus, 'IN_PROGRESS' | 'COMPLETED'>;

/**
 * Lifecycle authority is operation-specific. Capture callbacks may execute
 * only while capture is active; model passes which are intentionally queued
 * after End Session may execute against the just-completed encounter.
 */
const ALLOWED_SESSION_STATES = {
  transcribeChunkBeforeModel: ['IN_PROGRESS'],
  transcribeChunkBeforePersistence: ['IN_PROGRESS'],
  transcribeChunkBackstopBeforeModel: ['COMPLETED'],
  transcribeChunkBackstopBeforePersistence: ['COMPLETED'],
  pass1BeforeModel: ['IN_PROGRESS'],
  pass1BeforePersistence: ['COMPLETED'],
  pass2BeforeModel: ['COMPLETED'],
  pass2BeforePersistence: ['COMPLETED'],
  noteTranslationBeforeModel: ['COMPLETED'],
  legacyPass1BeforeModel: ['COMPLETED'],
  legacyPass1BeforePersistence: ['COMPLETED'],
  clinicalAnalysisBeforeModel: ['COMPLETED'],
  clinicalAnalysisBeforePersistence: ['COMPLETED'],
  differentialBeforeModel: ['COMPLETED'],
  differentialBeforePersistence: ['COMPLETED'],
  // Plan review is valid during an encounter and immediately after ending it.
  planDictationPass1BeforeModel: ['IN_PROGRESS', 'COMPLETED'],
  planDictationPass1BeforePersistence: ['IN_PROGRESS', 'COMPLETED'],
  planDictationPass14BeforeModel: ['IN_PROGRESS', 'COMPLETED'],
  planDictationPass14BeforePersistence: ['IN_PROGRESS', 'COMPLETED'],
} as const satisfies Record<ScribeAuthoritySource, readonly ActiveScribeSessionStatus[]>;

export interface ScribeAuthorityBoundary {
  psychologistId: string;
  /** Closed set of execution phases; patient or transcript content cannot be supplied. */
  source: ScribeAuthoritySource;
}

/**
 * Re-read lifecycle, standing consent, practitioner status and grants adjacent
 * to a background model execution or persistence boundary.
 */
export async function assertCurrentScribeAuthority(
  sessionId: string,
  boundary: ScribeAuthorityBoundary,
): Promise<{ psychologistId: string; clientId: string; vertical: 'THERAPIST' | 'DOCTOR' }> {
  const current = await prisma.$transaction(
    async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          psychologistId: true,
          clientId: true,
          status: true,
          client: { select: { status: true, deletedAt: true } },
          psychologist: { select: { vertical: true } },
        },
      });
      if (!session) return { session: null, consents: new Set<string>() };
      const rows = await tx.consent.findMany({
        where: {
          clientId: session.clientId,
          scope: { in: [...SCRIBE_CONSENT_SCOPES] },
          status: 'GRANTED',
          withdrawnAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { scope: true },
      });
      return { session, consents: new Set(rows.map(({ scope }) => scope)) };
    },
    { isolationLevel: 'Serializable' },
  );

  const session = current.session;
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.psychologistId !== boundary.psychologistId) {
    throw new Error('Session authorization context mismatch');
  }
  const allowedStates: readonly SessionStatus[] = ALLOWED_SESSION_STATES[boundary.source];
  if (!allowedStates.includes(session.status)) {
    await auditScribeDenial(sessionId, boundary, 'SESSION_STATE');
    throw new ScribeAuthorityError('SESSION_STATE');
  }
  if (session.client.status !== 'ACTIVE' || session.client.deletedAt !== null) {
    await auditScribeDenial(sessionId, boundary, 'CLIENT');
    throw new ScribeAuthorityError('CLIENT');
  }
  if (SCRIBE_CONSENT_SCOPES.some((scope) => !current.consents.has(scope))) {
    await auditScribeDenial(sessionId, boundary, 'CONSENT');
    throw new ScribeAuthorityError('CONSENT');
  }

  const documentation =
    session.psychologist.vertical === 'DOCTOR'
      ? 'MEDICAL_DOCUMENTATION'
      : 'BEHAVIORAL_HEALTH_DOCUMENTATION';
  await assertAuditedSessionCapabilities(sessionId, ['AMBIENT_CAPTURE', documentation], boundary);
  return {
    psychologistId: session.psychologistId,
    clientId: session.clientId,
    vertical: session.psychologist.vertical,
  };
}

async function auditScribeDenial(
  sessionId: string,
  boundary: ScribeAuthorityBoundary,
  reason: ScribeAuthorityDenialReason,
): Promise<void> {
  try {
    await writeAudit({
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: boundary.psychologistId,
      action: 'CAPABILITY_ACCESS_DENIED',
      targetType: 'ScribeAuthority',
      targetId: 'DENIED',
      metadata: { source: boundary.source, sessionId, reason },
    });
  } catch {
    console.error('[scribe-authority] Failed to persist authority-denial audit event.');
  }
}
