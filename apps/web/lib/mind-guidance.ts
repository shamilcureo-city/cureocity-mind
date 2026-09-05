import type { TherapyScriptV1 } from '@cureocity/contracts';

/** Navigation through a draft guide is deliberately not a clinical event. */
export interface MindGuideStep {
  id: string;
  title: string;
  kind: 'opening' | 'exercise' | 'closing' | 'between_sessions';
  text: string;
  listenFor: string | null;
  branches: { ifClientSays: string; thenDo: string }[];
}

export function mindGuideSteps(script: TherapyScriptV1): MindGuideStep[] {
  return [
    {
      id: 'opening',
      title: 'Open the conversation',
      kind: 'opening',
      text: script.openingScript,
      listenFor: null,
      branches: [],
    },
    ...script.mainExercise.steps.map((step, index) => ({
      // Keep UI identities unique even if an older model response reused an id.
      id: `exercise:${index}:${step.id}`,
      title: step.purpose,
      kind: 'exercise' as const,
      text: step.therapistSays,
      listenFor: step.listenFor,
      branches: step.branches,
    })),
    {
      id: 'closing',
      title: 'Reflect & close',
      kind: 'closing',
      text: script.closingScript,
      listenFor: null,
      branches: [],
    },
    {
      id: 'between_sessions',
      title: 'Agree the next step',
      kind: 'between_sessions',
      text: script.homework.description,
      listenFor: script.homework.deliveryNotes,
      branches: [],
    },
  ];
}

/** Unknown/stale ids never inflate the visible guide-review milestone. */
export function reviewedGuideCount(
  steps: readonly MindGuideStep[],
  reviewed: ReadonlySet<string>,
): number {
  return steps.filter((step) => reviewed.has(step.id)).length;
}

export function liveCopilotVisibleCounts(
  mode: 'quiet' | 'guided',
  planned: number,
  live: number,
  threads: number,
) {
  return mode === 'quiet'
    ? { planned: 0, live: 0, threads: 0 }
    : { planned: Math.min(1, planned), live: Math.min(1, live), threads: Math.min(1, threads) };
}
