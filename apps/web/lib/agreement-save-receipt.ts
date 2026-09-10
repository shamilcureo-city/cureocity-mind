import {
  SessionAgreementDtoSchema,
  type AgreementSpeaker,
  type SessionAgreementDto,
} from '@cureocity/contracts';

interface SaveIntent {
  sessionId: string;
  text: string;
  speaker: AgreementSpeaker;
  correction?: {
    agreementId: string;
    expectedRevision: number;
    operation: 'correct' | 'amend';
    reason: string;
  };
}

/** Creation identity does not depend on signing state, unlike an explicit amendment. */
export function agreementSaveFingerprint(intent: SaveIntent): string {
  return JSON.stringify(intent);
}

export function confirmedAgreementReceipt(
  body: unknown,
  intent: SaveIntent & { operationId: string },
): SessionAgreementDto | null {
  if (!body || typeof body !== 'object') return null;
  const response = body as { agreement?: unknown; operationId?: unknown };
  if (response.operationId !== intent.operationId) return null;
  const parsed = SessionAgreementDtoSchema.safeParse(response.agreement);
  if (!parsed.success) return null;
  const saved = parsed.data;
  if (!saved.id || saved.sessionId !== intent.sessionId) return null;
  if (intent.correction) {
    if (saved.id !== intent.correction.agreementId) return null;
    const revision = saved.revisions?.find((entry) => entry.operationId === intent.operationId);
    if (
      !revision ||
      revision.text !== intent.text ||
      revision.speaker !== intent.speaker ||
      revision.operation !== intent.correction.operation ||
      revision.reason !== intent.correction.reason
    )
      return null;
  } else {
    // Replaying creation after another tab's correction returns current wording
    // plus its original history, never a duplicate of superseded content.
    const original = saved.revisions?.[0];
    if (
      (original?.previousText ?? saved.text) !== intent.text ||
      (original?.previousSpeaker ?? saved.speaker) !== intent.speaker
    )
      return null;
  }
  return saved;
}
