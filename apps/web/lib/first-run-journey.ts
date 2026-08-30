export interface FirstRunState {
  hasExampleClient: boolean;
  hasRealClient: boolean;
  hasCompletedRoleplay: boolean;
  hasCompletedRealSession: boolean;
  hasReviewedRealNote: boolean;
}

export interface FirstRunAction {
  id: string;
  label: string;
  description: string;
  done: boolean;
  href: string;
  ctaLabel: string;
}

export interface FirstRunJourney {
  choices: FirstRunAction[];
  steps: FirstRunAction[];
  complete: boolean;
}

export function hasCompletedRoleplaySession(
  demoCreatedAt: Date,
  completedSessionScheduledAts: readonly Date[],
): boolean {
  return completedSessionScheduledAts.some((scheduledAt) => scheduledAt >= demoCreatedAt);
}

export function buildFirstRunJourney(state: FirstRunState): FirstRunJourney {
  const choices: FirstRunAction[] = [
    {
      id: 'roleplay',
      label: 'Try a five-minute roleplay',
      description: 'Practise the full session flow safely with the example client.',
      done: state.hasCompletedRoleplay,
      href: state.hasCompletedRoleplay ? '/app/clients' : '/app/encounters/new?roleplay=1',
      ctaLabel: state.hasCompletedRoleplay ? 'Start a real session' : 'Start roleplay',
    },
    {
      id: 'example',
      label: 'Explore the example client',
      description: 'See a complete Journey, notes, measures, and follow-up before adding anyone.',
      done: state.hasExampleClient,
      href: '/app/clients?example=1',
      ctaLabel: state.hasExampleClient ? 'Open example client' : 'Create example client',
    },
    {
      id: 'real-client',
      label: 'Use it with a real client',
      description: 'Add your first client and begin with informed consent.',
      done: state.hasRealClient,
      href: state.hasRealClient ? '/app/encounters/new' : '/app/clients?new=1',
      ctaLabel: state.hasRealClient ? 'Start a session' : 'Add a client',
    },
  ];

  const steps: FirstRunAction[] = [
    {
      id: 'client',
      label: 'Add a real client',
      description: 'Create the client record and capture consent before recording.',
      done: state.hasRealClient,
      href: '/app/clients?new=1',
      ctaLabel: 'Add client',
    },
    {
      id: 'session',
      label: 'Complete a real session',
      description: 'Record or use the live scribe, then close the session safely.',
      done: state.hasCompletedRealSession,
      href: '/app/encounters/new',
      ctaLabel: 'Start session',
    },
    {
      id: 'review',
      label: 'Review your first note',
      description: 'Check the generated draft and make it clinically yours.',
      done: state.hasReviewedRealNote,
      href: '/app/notes-due',
      ctaLabel: 'Review notes',
    },
  ];

  return { choices, steps, complete: steps.every((step) => step.done) };
}
