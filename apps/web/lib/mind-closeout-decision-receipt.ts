export type MindCloseoutDecisionStep =
  | 'clinicalSuggestions'
  | 'agreements'
  | 'nextSessionQuestions'
  | 'shared';
export type MindCloseoutDecisionOutcome = 'COMPLETE' | 'SKIPPED';

/** An HTTP 200 alone is not a confirmation of the intended session decision. */
export function confirmsMindCloseoutDecision(
  value: unknown,
  intent: {
    sessionId: string;
    step: MindCloseoutDecisionStep;
    outcome: MindCloseoutDecisionOutcome;
  },
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.sessionId !== intent.sessionId) return false;
  if (intent.step !== 'clinicalSuggestions' && intent.outcome !== 'SKIPPED') return false;
  const timestampField =
    intent.step === 'clinicalSuggestions'
      ? intent.outcome === 'COMPLETE'
        ? 'clinicalSuggestionsResolvedAt'
        : 'clinicalSuggestionsSkippedAt'
      : intent.step === 'agreements'
        ? 'agreementsSkippedAt'
        : intent.step === 'nextSessionQuestions'
          ? 'nextQuestionsSkippedAt'
          : 'shareSkippedAt';
  const timestamp = record[timestampField];
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return false;
  if (intent.step === 'clinicalSuggestions') {
    const opposingField =
      intent.outcome === 'COMPLETE'
        ? 'clinicalSuggestionsSkippedAt'
        : 'clinicalSuggestionsResolvedAt';
    if (record[opposingField] !== null) return false;
  }
  return true;
}
