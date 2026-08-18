import { SCRIBE_CONSENT_SCOPES } from './consent-gate';
import { assertAuditedSessionCapabilities } from './capabilities';
import { writeAudit } from './audit';
import { prisma } from './prisma';

export type ScribeAuthorityDenialReason = 'CLIENT' | 'CONSENT';

export class ScribeAuthorityError extends Error {
  constructor(readonly reason: ScribeAuthorityDenialReason) {
    super('Current scribe authority is not available');
    this.name = 'ScribeAuthorityError';
  }
}

export type ScribeAuthoritySource =
  | 'transcribeChunkBeforeModel'
  | 'transcribeChunkBeforePersistence'
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
  | 'differentialBeforePersistence';

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
