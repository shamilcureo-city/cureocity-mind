import { NextRequest, NextResponse } from 'next/server';
import { MindRecoveryInputSchema } from '@cureocity/contracts';
import { requireCapability } from '@/lib/auth-server';
import { parseJson } from '@/lib/validate';
import { prisma } from '@/lib/prisma';
import { encryptForTenant, decryptForTenant } from '@/lib/tenant-crypto';
import { lockActiveClientForSession, ClientPhiWriteForbiddenError } from '@/lib/phi-write-lock';
import { assertValidScribeConsent, consentAuthorizationResponse } from '@/lib/consent-gate';
import { writeAudit, auditMetadataFromRequest } from '@/lib/audit';
import {
  buildRecoveryPrefix,
  canExtendRecoveryPrefix,
  type RecoveryPrefix,
} from '@/lib/mind-recovery-prefix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
class RecoveryConflict extends Error {}

/** Persist captured words, without claiming an AI note or a signature exists. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCapability(req, 'BEHAVIORAL_HEALTH_DOCUMENTATION');
  if (!auth.ok) return auth.response;
  if (auth.value.user.vertical !== 'THERAPIST')
    return NextResponse.json({ error: 'Mind recovery only' }, { status: 409 });
  const input = await parseJson(req, MindRecoveryInputSchema);
  if (!input.ok) return input.response;
  const { id: sessionId } = await params;
  const prefix = buildRecoveryPrefix(input.value.utterances);
  try {
    const encrypted = await encryptForTenant(auth.value.psychologistId, JSON.stringify(prefix));
    const transcriptEncrypted = await encryptForTenant(
      auth.value.psychologistId,
      prefix.transcript,
    );
    await prisma.$transaction(async (tx) => {
      await lockActiveClientForSession(tx, sessionId, auth.value.psychologistId);
      await tx.$queryRaw`SELECT "id" FROM "sessions" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { therapyNote: { select: { id: true } }, noteDraft: true },
      });
      if (!session || session.psychologistId !== auth.value.psychologistId || session.therapyNote)
        throw new RecoveryConflict('This session cannot accept a recovery transcript.');
      if (!['IN_PROGRESS', 'COMPLETED'].includes(session.status))
        throw new RecoveryConflict('Start the consented session before recovery.');
      if (session.status === 'COMPLETED' && input.value.action === 'CONTINUE_RECORDING')
        throw new RecoveryConflict('A completed session cannot resume capture.');
      await assertValidScribeConsent(session.consentSnapshot, session.clientId, tx);
      const draft = session.noteDraft;
      if (draft?.status === 'COMPLETED' || draft?.status === 'IN_PROGRESS' || draft?.content)
        throw new RecoveryConflict(
          'A note already exists or is generating. Open the session to review it.',
        );
      if (draft?.recoveryTranscriptEncrypted) {
        const decoded = await decryptForTenant(
          auth.value.psychologistId,
          draft.recoveryTranscriptEncrypted,
        );
        if (!decoded || !canExtendRecoveryPrefix(JSON.parse(decoded) as RecoveryPrefix, prefix))
          throw new RecoveryConflict(
            'Saved recovery words differ. Reopen the original session; do not overwrite them.',
          );
      } else if (await tx.audioChunk.count({ where: { sessionId } })) {
        throw new RecoveryConflict(
          'Recorded audio already exists; cannot safely prepend an unrelated live transcript.',
        );
      }
      const saved = await tx.noteDraft.upsert({
        where: { sessionId },
        create: {
          sessionId,
          status: 'PENDING',
          recoveryTranscriptEncrypted: encrypted,
          transcriptEncrypted,
        },
        update: {
          recoveryTranscriptEncrypted: encrypted,
          transcriptEncrypted,
          status: 'PENDING',
          errorMessage: null,
        },
      });
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'NOTE_DRAFT_EDITED',
          targetType: 'NoteDraft',
          targetId: saved.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            source: 'LIVE_RECOVERY',
            action: input.value.action,
            utteranceCount: input.value.utterances.length,
            transcriptChars: prefix.transcript.length,
          },
        },
        tx,
      );
      if (input.value.action === 'FINALIZE' && session.status === 'IN_PROGRESS') {
        await tx.session.update({
          where: { id: sessionId },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });
        await writeAudit(
          {
            actorType: 'PSYCHOLOGIST',
            actorPsychologistId: auth.value.psychologistId,
            action: 'SESSION_ENDED',
            targetType: 'Session',
            targetId: sessionId,
            metadata: { ...auditMetadataFromRequest(req), source: 'LIVE_RECOVERY' },
          },
          tx,
        );
      }
    });
    return NextResponse.json({ saved: true, sessionId, action: input.value.action });
  } catch (error) {
    const consent = consentAuthorizationResponse(error);
    if (consent) return consent;
    if (error instanceof ClientPhiWriteForbiddenError)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    if (error instanceof RecoveryConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(
      { error: 'Recovery could not be saved securely. Keep this tab open and retry.' },
      { status: 503 },
    );
  }
}
