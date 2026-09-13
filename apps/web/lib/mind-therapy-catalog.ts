/** Display taxonomy for the existing guide choices, not a clinical protocol registry. */
export type MindTherapyGuideKind = 'approach' | 'technique' | 'protocol_stage';

export interface MindTherapyGuideChoice {
  id: string;
  /** Keep exact legacy names: the generation request and cache use this value. */
  name: string;
  kind: MindTherapyGuideKind;
  emdrTrainingNotice?: true;
}

export const MIND_THERAPY_GUIDE_CATALOG: readonly MindTherapyGuideChoice[] = [
  { id: 'cognitive-restructuring', name: 'Cognitive Restructuring', kind: 'technique' },
  { id: 'behavioural-activation', name: 'Behavioural Activation', kind: 'technique' },
  { id: 'graded-exposure', name: 'Graded Exposure', kind: 'technique' },
  { id: 'mbct', name: 'Mindfulness-Based Cognitive Therapy', kind: 'approach' },
  { id: 'act', name: 'Acceptance and Commitment Therapy', kind: 'approach' },
  { id: 'problem-solving', name: 'Problem-Solving Therapy', kind: 'approach' },
  {
    id: 'sleep-hygiene-stimulus-control',
    name: 'Sleep Hygiene + Stimulus Control',
    kind: 'technique',
  },
  {
    id: 'emdr-assessment',
    name: 'EMDR Phase 3 — Assessment',
    kind: 'protocol_stage',
    emdrTrainingNotice: true,
  },
  {
    id: 'emdr-desensitisation',
    name: 'EMDR Phase 4 — Desensitisation',
    kind: 'protocol_stage',
    emdrTrainingNotice: true,
  },
  { id: 'motivational-interviewing', name: 'Motivational Interviewing', kind: 'approach' },
];

export const MIND_THERAPY_GUIDE_KIND_LABELS: Record<MindTherapyGuideKind, string> = {
  approach: 'Approach',
  technique: 'Technique',
  protocol_stage: 'Protocol stage',
};

export const EMDR_GUIDE_TRAINING_NOTICE =
  'For clinicians trained in EMDR. This AI draft does not replace specialist training or supervision.';

/** Unknown AI recommendations remain accessible without an invented classification. */
export function mindTherapyGuideChoice(name: string): MindTherapyGuideChoice | undefined {
  return MIND_THERAPY_GUIDE_CATALOG.find((choice) => choice.name === name);
}
