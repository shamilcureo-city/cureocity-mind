import { describe, expect, it } from 'vitest';
import { noteProcessingJourney } from './note-processing-journey';

describe('note processing journey', () => {
  it.each([
    ['PENDING', 'GENERATING', 'NOTE_GENERATING', 'Generating'],
    ['IN_PROGRESS', 'GENERATING', 'NOTE_GENERATING', 'Generating'],
    ['COMPLETED', 'READY_TO_REVIEW', 'NOTE_REVIEW', 'Ready to review'],
    ['FAILED', 'NEEDS_ATTENTION', 'NOTE_NEEDS_ATTENTION', 'Needs attention'],
  ] as const)('maps %s to an explicit Today state', (draftStatus, state, queueKind, label) => {
    expect(noteProcessingJourney(draftStatus)).toMatchObject({ state, queueKind, label });
  });

  it('tells the therapist it is safe to leave while generation continues', () => {
    expect(noteProcessingJourney('IN_PROGRESS').message).toContain('safely return to Today');
  });
});
