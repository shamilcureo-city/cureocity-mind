import { describe, expect, it } from 'vitest';
import { agreementSaveFingerprint, confirmedAgreementReceipt } from './agreement-save-receipt';

const operationId = 'daf32f03-d826-47e8-9152-07ef7ff265c5';
const intent = {
  sessionId: 'session-1',
  text: 'Original fictional agreement',
  speaker: 'CLIENT' as const,
};
const agreement = {
  id: 'agreement-1',
  sessionId: intent.sessionId,
  text: intent.text,
  speaker: intent.speaker,
  followUp: null,
  createdAt: '2026-09-09T10:00:00.000Z',
  revision: 0,
  revisions: [],
};
const revision = {
  revision: 1,
  operationId,
  operation: 'amend' as const,
  reason: 'CORRECTION' as const,
  previousText: intent.text,
  previousSpeaker: intent.speaker,
  previousFollowUp: null,
  previousFollowUpAt: null,
  text: 'Corrected wording',
  speaker: 'THERAPIST' as const,
  recordedAt: agreement.createdAt,
  recordedBy: 'psy-1',
  signedNoteId: 'note-1',
};

describe('agreement save identity and acknowledged receipts', () => {
  it('keeps creation identity scoped to the actual payload and session, without signature state', () => {
    expect(agreementSaveFingerprint(intent)).toBe(JSON.stringify(intent));
    expect(agreementSaveFingerprint(intent)).not.toContain('amend');
    expect(agreementSaveFingerprint({ ...intent, text: 'Different intent' })).not.toBe(
      agreementSaveFingerprint(intent),
    );
    expect(agreementSaveFingerprint({ ...intent, sessionId: 'other-session' })).not.toBe(
      agreementSaveFingerprint(intent),
    );
  });
  it('only accepts a complete receipt for this creation operation and wording', () => {
    expect(
      confirmedAgreementReceipt({ agreement, operationId }, { ...intent, operationId }),
    ).toEqual(agreement);
    for (const body of [
      null,
      {},
      { agreement },
      { agreement, operationId: 'other' },
      { agreement: { ...agreement, text: 'Other text' }, operationId },
      { agreement: { ...agreement, sessionId: 'other' }, operationId },
      { agreement: { id: 'a' }, operationId },
    ]) {
      expect(confirmedAgreementReceipt(body, { ...intent, operationId })).toBeNull();
    }
  });
  it('accepts a replayed creation receipt with later amended wording only when original intent matches', () => {
    const updated = {
      ...agreement,
      text: revision.text,
      speaker: revision.speaker,
      revision: 1,
      revisions: [revision],
    };
    expect(
      confirmedAgreementReceipt({ agreement: updated, operationId }, { ...intent, operationId }),
    ).toEqual(updated);
    expect(
      confirmedAgreementReceipt(
        { agreement: updated, operationId },
        { ...intent, text: 'Not the original', operationId },
      ),
    ).toBeNull();
  });
  it('requires matching amendment history, agreement id and reason before clearing typed corrections', () => {
    const updated = {
      ...agreement,
      text: revision.text,
      speaker: revision.speaker,
      revision: 1,
      revisions: [revision],
    };
    const correction = {
      agreementId: agreement.id,
      expectedRevision: 0,
      operation: 'amend' as const,
      reason: 'CORRECTION',
    };
    const amendedIntent = {
      ...intent,
      text: revision.text,
      speaker: revision.speaker,
      correction,
      operationId,
    };
    expect(confirmedAgreementReceipt({ agreement: updated, operationId }, amendedIntent)).toEqual(
      updated,
    );
    expect(
      confirmedAgreementReceipt(
        { agreement: { ...updated, revisions: [] }, operationId },
        amendedIntent,
      ),
    ).toBeNull();
    expect(
      confirmedAgreementReceipt(
        { agreement: { ...updated, id: 'other' }, operationId },
        amendedIntent,
      ),
    ).toBeNull();
    expect(
      confirmedAgreementReceipt(
        { agreement: updated, operationId },
        { ...amendedIntent, correction: { ...correction, reason: 'CLARIFICATION' } },
      ),
    ).toBeNull();
  });
});
