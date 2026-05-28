/**
 * CBT 5-phase model used by V1.
 *
 * Phases follow the manualized Beck-style CBT structure widely used in
 * Indian psychotherapy practice. The PRD (Appendix B in PRD 22.1) would
 * be the canonical source; the labels and ordering below match standard
 * teaching practice. Specific transition guards (per PR 2) reflect
 * standard practice — defer phase-progression cadence to clinician input
 * once we have pilot data.
 */

export const CBT_PHASES = [
  'engagement_assessment',
  'psychoeducation',
  'cognitive_restructuring',
  'behavioral_activation',
  'consolidation_relapse_prevention',
] as const;

export type CbtPhase = (typeof CBT_PHASES)[number];

export const CBT_PHASE_DESCRIPTIONS: Record<CbtPhase, string> = {
  engagement_assessment:
    'Intake, formulation, goal-setting, therapeutic alliance, baseline measures',
  psychoeducation:
    'Explain CBT model, normalize symptoms, introduce the cognitive triangle and the role of homework',
  cognitive_restructuring:
    'Thought records, identifying cognitive distortions, restructuring, evidence gathering',
  behavioral_activation:
    'Behavioural experiments, activity scheduling, graded exposure where indicated',
  consolidation_relapse_prevention:
    'Review gains against goals, relapse-prevention plan, taper, structured termination',
};

/** First canonical phase (the one POST /workflows starts on by default). */
export const CBT_INITIAL_PHASE: CbtPhase = 'engagement_assessment';

/** The canonical forward order — useful for "what comes next?" UIs. */
export function nextCbtPhase(current: CbtPhase): CbtPhase | null {
  const idx = CBT_PHASES.indexOf(current);
  if (idx < 0 || idx === CBT_PHASES.length - 1) return null;
  return CBT_PHASES[idx + 1] ?? null;
}

export function isCbtPhase(value: unknown): value is CbtPhase {
  return typeof value === 'string' && (CBT_PHASES as readonly string[]).includes(value);
}
