import { describe, expect, it } from 'vitest';
import { MindSessionCloseoutSchema } from './mind-session-closeout';
import { CreateSessionInputSchema } from './session';

describe('MindSessionCloseoutSchema', () => {
  it('accepts the single Mind Review & Close checklist', () => {
    const parsed = MindSessionCloseoutSchema.parse({
      product: 'MIND',
      status: 'REVIEW_AND_CLOSE',
      steps: {
        noteGenerated: 'COMPLETE',
        noteReviewed: 'PENDING',
        clinicalSuggestions: 'PENDING',
        agreements: 'PENDING',
        nextSessionQuestions: 'PENDING',
        signed: 'PENDING',
        shared: 'PENDING',
        followUp: 'PENDING',
      },
    });

    expect(parsed.product).toBe('MIND');
    expect(Object.keys(parsed.steps)).toHaveLength(8);
  });

  it('cannot be consumed as a Scribe closeout contract', () => {
    expect(
      MindSessionCloseoutSchema.safeParse({
        product: 'SCRIBE',
        status: 'COMPLETE',
        steps: {},
      }).success,
    ).toBe(false);
  });

  it('accepts a source session when scheduling an idempotent follow-up', () => {
    const parsed = CreateSessionInputSchema.safeParse({
      clientId: 'cm12345678901234567890123',
      sourceSessionId: 'cm12345678901234567890124',
      scheduledAt: '2026-09-05T04:30:00.000Z',
    });
    expect(parsed.success && parsed.data.sourceSessionId).toBe('cm12345678901234567890124');
  });
});
