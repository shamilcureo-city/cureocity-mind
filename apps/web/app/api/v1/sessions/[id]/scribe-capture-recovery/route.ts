import { NextRequest, NextResponse } from 'next/server';
import {
  containsMedicalTranscriptionExample,
  containsTranscriptionArtifact,
} from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { encryptForTenant, decryptForTenant } from '@/lib/tenant-crypto';
import { lockActiveClientForSession, ClientPhiWriteForbiddenError } from '@/lib/phi-write-lock';
import { assertValidScribeConsent, consentAuthorizationResponse } from '@/lib/consent-gate';
import { writeAudit, auditMetadataFromRequest } from '@/lib/audit';
import { parseJson } from '@/lib/validate';
import {
  ScribeCaptureRecoverySchema,
  extendsScribeCaptureRecovery,
  scribeRecoveryTranscript,
} from '@/lib/scribe-capture-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
class RecoveryConflict extends Error {}
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function handle(req: NextRequest, context: Context, write: boolean) {
  const auth = await requireCapability(req, 'MEDICAL_DOCUMENTATION');
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'DOCTOR') return json({ error: 'Scribe recovery only' }, 403);
  const { id: sessionId } = await context.params;
  const input = write ? await parseJson(req, ScribeCaptureRecoverySchema) : null;
  if (input && !input.ok) return input.response;
  const next = input?.ok ? input.value : null;
  if (
    next &&
    (containsTranscriptionArtifact(JSON.stringify(next)) ||
      containsMedicalTranscriptionExample(JSON.stringify(next)))
  )
    return json(
      {
        error: 'Suspected transcription artifact. Keep this consultation unsigned.',
        code: 'TRANSCRIPTION_ARTIFACT',
      },
      422,
    );
  try {
    const encrypted = next
      ? await encryptForTenant(auth.value.psychologistId, JSON.stringify(next))
      : null;
    const result = await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { noteDraft: true, therapyNote: { select: { id: true } } },
      });
      if (!session || session.psychologistId !== auth.value.psychologistId)
        throw new ClientPhiWriteForbiddenError();
      if (
        session.mindDocumentationMode === 'MANUAL' ||
        session.therapyNote ||
        !['SCHEDULED', 'IN_PROGRESS'].includes(session.status) ||
        session.noteDraft?.content ||
        ['COMPLETED', 'IN_PROGRESS'].includes(session.noteDraft?.status ?? '')
      )
        throw new RecoveryConflict(
          'This encounter already has a note or is closed. Open its saved record.',
        );
      if (next && (session.status !== 'IN_PROGRESS' || session.captureMode !== 'LIVE'))
        throw new RecoveryConflict('Live capture has not been activated.');
      if (next) await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
      const ciphertext = session.noteDraft?.recoveryTranscriptEncrypted;
      const decoded = ciphertext
        ? await decryptForTenant(auth.value.psychologistId, ciphertext)
        : null;
      if (ciphertext && !decoded) throw new Error('Secure recovery could not be decrypted');
      const previous = decoded ? ScribeCaptureRecoverySchema.parse(JSON.parse(decoded)) : null;
      if (!next) {
        if (previous)
          await writeAudit(
            {
              actorType: 'PSYCHOLOGIST',
              actorPsychologistId: auth.value.psychologistId,
              action: 'NOTE_DRAFT_VIEWED',
              targetType: 'NoteDraft',
              targetId: session.noteDraft!.id,
              metadata: {
                ...auditMetadataFromRequest(req),
                source: 'SCRIBE_CAPTURE_RECOVERY',
                sessionId,
              },
            },
            tx,
          );
        return { sessionId, recovery: previous };
      }
      if (previous && !extendsScribeCaptureRecovery(previous, next))
        throw new RecoveryConflict(
          'Saved captured words differ. Keep this tab open; do not overwrite the original source.',
        );
      if (!previous && (await tx.audioChunk.count({ where: { sessionId } })))
        throw new RecoveryConflict('Recorded audio already exists for this encounter.');
      // Only the encrypted recovery field is written. This is not a completed
      // note, a source verification, a signature, or a lifecycle transition.
      const draft = await tx.noteDraft.upsert({
        where: { sessionId },
        create: { sessionId, status: 'PENDING', recoveryTranscriptEncrypted: encrypted },
        update: { recoveryTranscriptEncrypted: encrypted },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_EDITED',
          targetType: 'NoteDraft',
          targetId: draft.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            source: 'SCRIBE_CAPTURE_CHECKPOINT',
            sessionId,
            utteranceCount: next.utterances.length,
            transcriptChars: scribeRecoveryTranscript(next).length,
          },
        },
        tx,
      );
      return { saved: true, sessionId, utteranceCount: next.utterances.length };
    });
    return json(result);
  } catch (error) {
    const consent = consentAuthorizationResponse(error);
    if (consent) return consent;
    if (error instanceof ClientPhiWriteForbiddenError)
      return json({ error: 'Session not found' }, 404);
    if (error instanceof RecoveryConflict) return json({ error: error.message }, 409);
    return json(
      { error: 'Captured words could not be recovered securely. Keep this tab open and retry.' },
      503,
    );
  }
}
export const GET = (req: NextRequest, context: Context) => handle(req, context, false);
export const PUT = (req: NextRequest, context: Context) => handle(req, context, true);
