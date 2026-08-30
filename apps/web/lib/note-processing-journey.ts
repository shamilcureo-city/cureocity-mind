export type NoteDraftJourneyStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export type NoteProcessingJourney =
  | {
      state: 'GENERATING';
      queueKind: 'NOTE_GENERATING';
      label: 'Generating';
      message: string;
    }
  | {
      state: 'READY_TO_REVIEW';
      queueKind: 'NOTE_REVIEW';
      label: 'Ready to review';
      message: string;
    }
  | {
      state: 'NEEDS_ATTENTION';
      queueKind: 'NOTE_NEEDS_ATTENTION';
      label: 'Needs attention';
      message: string;
    };

export function noteProcessingJourney(status: NoteDraftJourneyStatus): NoteProcessingJourney {
  if (status === 'COMPLETED') {
    return {
      state: 'READY_TO_REVIEW',
      queueKind: 'NOTE_REVIEW',
      label: 'Ready to review',
      message: 'Your note is ready for Review & Close.',
    };
  }
  if (status === 'FAILED') {
    return {
      state: 'NEEDS_ATTENTION',
      queueKind: 'NOTE_NEEDS_ATTENTION',
      label: 'Needs attention',
      message: 'Note generation needs your attention before Review & Close.',
    };
  }
  return {
    state: 'GENERATING',
    queueKind: 'NOTE_GENERATING',
    label: 'Generating',
    message: 'Your recording is saved. You may safely return to Today while the note is generated.',
  };
}
