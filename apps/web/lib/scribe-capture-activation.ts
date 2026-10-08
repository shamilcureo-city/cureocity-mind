import type { LiveAuthorityRequest, PractitionerCapability } from '@cureocity/contracts';
import { prisma } from './prisma';
import { getEffectiveCapabilities, serializeCapabilities } from './capabilities';
import { assertValidScribeConsent, withClientConsentLock } from './consent-gate';
import { scribeConsentAllowsMode } from './scribe-consent-mode';
import { assertScribeTeleconsultDocumentationConsent } from './scribe-teleconsult';
import { conditionalSessionTransition } from './session-transition';
import { writeAudit } from './audit';

/**
 * Called only by the service-secret-protected gateway verifier. Preflight is
 * read-only; capture-activation is sent for first accepted PCM, never token mint.
 * Keep the existing capture/output verifier unchanged for all other purposes.
 */
export async function authorizeScribeCapturePreparation(
  input: LiveAuthorityRequest,
): Promise<PractitionerCapability[]> {
  if (
    input.vertical !== 'DOCTOR' ||
    !['preflight', 'capture-activation'].includes(input.purpose ?? '')
  )
    throw new Error('denied');
  return prisma.$transaction(
    async (tx) => {
      const owner = await tx.session.findUnique({
        where: { id: input.sessionId },
        select: { clientId: true },
      });
      if (!owner) throw new Error('denied');
      return withClientConsentLock(tx, owner.clientId, async () => {
        const session = await tx.session.findUnique({
          where: { id: input.sessionId },
          select: {
            psychologistId: true,
            clientId: true,
            status: true,
            captureMode: true,
            consentSnapshot: true,
            mindDocumentationMode: true,
            client: { select: { deletedAt: true } },
            psychologist: { select: { vertical: true } },
          },
        });
        if (
          !session ||
          session.clientId !== owner.clientId ||
          session.psychologistId !== input.psychologistId ||
          session.psychologist.vertical !== 'DOCTOR' ||
          !session.client ||
          session.client.deletedAt !== null ||
          !['SCHEDULED', 'IN_PROGRESS'].includes(session.status) ||
          session.captureMode !== 'LIVE' ||
          session.mindDocumentationMode === 'MANUAL' ||
          input.tokenExpiresAt <= Math.floor(Date.now() / 1000) ||
          !scribeConsentAllowsMode(session.consentSnapshot, 'LIVE')
        )
          throw new Error('denied');
        await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
        await assertScribeTeleconsultDocumentationConsent(
          tx,
          input.sessionId,
          input.psychologistId,
          'capture',
        );
        const effective = await getEffectiveCapabilities(input.psychologistId);
        if (
          !effective.capabilities.has('LIVE_ENCOUNTER') ||
          !effective.capabilities.has('MEDICAL_DOCUMENTATION')
        )
          throw new Error('denied');
        if (input.purpose === 'capture-activation' && session.status === 'SCHEDULED') {
          await conditionalSessionTransition(tx, {
            sessionId: input.sessionId,
            expectedStatus: 'SCHEDULED',
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
          });
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: input.psychologistId,
              action: 'SESSION_STARTED',
              targetType: 'Session',
              targetId: input.sessionId,
              metadata: { source: 'LIVE_GATEWAY_FIRST_AUDIO' },
            },
            tx,
          );
        }
        return serializeCapabilities(effective);
      });
    },
    { isolationLevel: 'Serializable' },
  );
}
