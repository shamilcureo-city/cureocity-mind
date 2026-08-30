import { describe, expect, it } from 'vitest';
import { deriveMindSessionCloseout } from './mind-session-closeout';

describe('deriveMindSessionCloseout', () => {
  it('maps a completed draft to the one Review & Close status', () => {
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: false,
      noteReviewed: false,
      suggestionsResolved: false,
      agreementsCaptured: false,
      nextQuestionsSelected: false,
      shared: false,
      followUpScheduled: false,
    });

    expect(closeout.status).toBe('REVIEW_AND_CLOSE');
    expect(closeout.steps.noteGenerated).toBe('COMPLETE');
    expect(closeout.steps.signed).toBe('PENDING');
  });

  it('maps signed legacy sessions safely without inventing unfinished work', () => {
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: true,
      legacySession: true,
      shared: false,
      followUpScheduled: false,
    });

    expect(closeout.status).toBe('COMPLETE');
    expect(closeout.steps.noteReviewed).toBe('COMPLETE');
    expect(closeout.steps.clinicalSuggestions).toBe('SKIPPED');
    expect(closeout.steps.agreements).toBe('SKIPPED');
    expect(closeout.steps.nextSessionQuestions).toBe('SKIPPED');
    expect(closeout.steps.shared).toBe('SKIPPED');
    expect(closeout.steps.followUp).toBe('SKIPPED');
  });

  it('maps signed current sessions from durable evidence without skipping missing work', () => {
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'COMPLETED',
      noteSigned: true,
      agreementsCaptured: true,
      nextQuestionsSkipped: true,
      shared: true,
      followUpScheduled: true,
    });

    expect(closeout.steps.agreements).toBe('COMPLETE');
    expect(closeout.steps.nextSessionQuestions).toBe('SKIPPED');
    expect(closeout.steps.shared).toBe('COMPLETE');
    expect(closeout.steps.followUp).toBe('COMPLETE');
    expect(closeout.steps.clinicalSuggestions).toBe('PENDING');
    expect(closeout.status).toBe('REVIEW_AND_CLOSE');
  });

  it('keeps a failed note in needs-attention rather than ready to close', () => {
    const closeout = deriveMindSessionCloseout({
      draftStatus: 'FAILED',
      noteSigned: false,
    });

    expect(closeout.status).toBe('NEEDS_ATTENTION');
    expect(closeout.steps.noteGenerated).toBe('PENDING');
  });
});
