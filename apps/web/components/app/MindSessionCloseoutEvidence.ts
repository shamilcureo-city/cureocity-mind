import { CarriedQuestionSchema, type CarriedQuestion } from '@cureocity/contracts';

/** Generated assessment gaps are suggestions, not clinician selections. Only
 * explicitly carried questions attributed to this encounter count here. */
export function selectedQuestionsForSession(value: unknown, sessionId: string): CarriedQuestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = CarriedQuestionSchema.safeParse(item);
    return parsed.success && parsed.data.sourceSessionId === sessionId ? [parsed.data] : [];
  });
}
