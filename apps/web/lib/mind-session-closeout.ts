import type { MindCloseoutStepState, MindSessionCloseout } from '@cureocity/contracts';

type DraftStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | null;

export interface MindSessionCloseoutSource {
  draftStatus: DraftStatus;
  noteSigned: boolean;
  noteReviewed?: boolean;
  suggestionsResolved?: boolean;
  suggestionsSkipped?: boolean;
  agreementsCaptured?: boolean;
  agreementsSkipped?: boolean;
  nextQuestionsSelected?: boolean;
  nextQuestionsSkipped?: boolean;
  shared?: boolean;
  shareSkipped?: boolean;
  followUpScheduled?: boolean;
  followUpSkipped?: boolean;
  legacySession?: boolean;
}

function optionalStep(
  completed: boolean | undefined,
  skipped: boolean | undefined,
  legacyComplete: boolean,
): MindCloseoutStepState {
  if (completed) return 'COMPLETE';
  if (skipped || legacyComplete) return 'SKIPPED';
  return 'PENDING';
}

export function deriveMindSessionCloseout(source: MindSessionCloseoutSource): MindSessionCloseout {
  const noteGenerated = source.draftStatus === 'COMPLETED' ? 'COMPLETE' : 'PENDING';
  const legacyComplete = source.legacySession === true && source.noteSigned;
  const steps: MindSessionCloseout['steps'] = {
    noteGenerated,
    noteReviewed: source.noteReviewed || source.noteSigned ? 'COMPLETE' : 'PENDING',
    clinicalSuggestions: optionalStep(
      source.suggestionsResolved,
      source.suggestionsSkipped,
      legacyComplete,
    ),
    agreements: optionalStep(source.agreementsCaptured, source.agreementsSkipped, legacyComplete),
    nextSessionQuestions: optionalStep(
      source.nextQuestionsSelected,
      source.nextQuestionsSkipped,
      legacyComplete,
    ),
    signed: source.noteSigned ? 'COMPLETE' : 'PENDING',
    shared: optionalStep(source.shared, source.shareSkipped, legacyComplete),
    followUp: optionalStep(source.followUpScheduled, source.followUpSkipped, legacyComplete),
  };

  const complete = Object.values(steps).every((step) => step !== 'PENDING');
  const status: MindSessionCloseout['status'] =
    source.noteSigned && complete
      ? 'COMPLETE'
      : source.draftStatus === 'FAILED'
        ? 'NEEDS_ATTENTION'
        : source.draftStatus === 'COMPLETED'
          ? 'REVIEW_AND_CLOSE'
          : 'GENERATING';

  return { product: 'MIND', status, steps };
}
