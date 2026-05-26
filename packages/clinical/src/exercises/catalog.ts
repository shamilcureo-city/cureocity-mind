import type { CbtExerciseDefinition } from './types';

/**
 * 20 CBT exercises spanning the 5-phase model.
 *
 * IMPORTANT: PRD 22.1 Appendix D specifies the canonical V1 catalog.
 * The entries below are clinician-recognizable defaults — labels and
 * descriptions track standard CBT practice (Beck, Padesky, manualized
 * cognitive therapy) but may need wording revisions to match the PRD
 * exactly. Mark each entry's `id` is stable so localisation strings
 * (Sprint 5) can key off it without rewording risk.
 */
export const CBT_EXERCISE_CATALOG: readonly CbtExerciseDefinition[] = [
  // --- Phase 1: engagement_assessment ---
  {
    id: 'cbt_intake_phq9',
    title: 'PHQ-9 depression screen',
    category: 'outcome_measure',
    phaseTags: ['engagement_assessment', 'consolidation_relapse_prevention'],
    description: 'Standardised 9-item depression severity questionnaire (gap G4 — V1 outcome).',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'phq9',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_intake_gad7',
    title: 'GAD-7 anxiety screen',
    category: 'outcome_measure',
    phaseTags: ['engagement_assessment', 'consolidation_relapse_prevention'],
    description: 'Standardised 7-item anxiety severity questionnaire (gap G4).',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'gad7',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_intake_whodas2',
    title: 'WHODAS-2.0 functioning assessment',
    category: 'outcome_measure',
    phaseTags: ['engagement_assessment', 'consolidation_relapse_prevention'],
    description: 'WHO Disability Assessment Schedule 2.0 (12-item) — baseline functioning.',
    estimatedDurationMin: 8,
    riskGate: 'always_safe',
    responseSchema: 'whodas2',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_problem_list',
    title: 'Problem and goal list',
    category: 'skill_building',
    phaseTags: ['engagement_assessment'],
    description:
      'Client lists current problems, ranks priority, and pairs each with a SMART goal for therapy.',
    estimatedDurationMin: 15,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },

  // --- Phase 2: psychoeducation ---
  {
    id: 'cbt_cognitive_triangle_intro',
    title: 'The cognitive triangle: thoughts, feelings, behaviour',
    category: 'psychoeducation',
    phaseTags: ['psychoeducation'],
    description:
      'Short read + diagram explaining how thoughts, feelings, and behaviour interact. Anchors all subsequent CBT skills.',
    estimatedDurationMin: 10,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_cognitive_distortions_list',
    title: 'Common cognitive distortions',
    category: 'psychoeducation',
    phaseTags: ['psychoeducation', 'cognitive_restructuring'],
    description:
      'Worksheet listing the 10 most common cognitive distortions with examples; client tags which they recognise.',
    estimatedDurationMin: 15,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_diaphragmatic_breathing',
    title: 'Diaphragmatic breathing primer',
    category: 'skill_building',
    phaseTags: ['psychoeducation', 'cognitive_restructuring', 'behavioral_activation'],
    description:
      'Audio-guided 4-7-8 breath training. Goal: practise twice daily to lower physiological arousal.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'mood_rating_0_10',
    cadence: 'daily',
  },

  // --- Phase 3: cognitive_restructuring ---
  {
    id: 'cbt_thought_record_5col',
    title: '5-column thought record',
    category: 'cognitive',
    phaseTags: ['cognitive_restructuring'],
    description:
      'Situation → automatic thought → emotion → evidence-for/against → balanced response. Workhorse exercise of Phase 3.',
    estimatedDurationMin: 15,
    riskGate: 'medium_or_lower',
    responseSchema: 'thought_record',
    cadence: 'weekly',
  },
  {
    id: 'cbt_abc_worksheet',
    title: 'A-B-C worksheet',
    category: 'cognitive',
    phaseTags: ['cognitive_restructuring'],
    description:
      'Activating event → Beliefs → Consequences. Lighter-weight than the 5-column for new clients.',
    estimatedDurationMin: 10,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },
  {
    id: 'cbt_downward_arrow',
    title: 'Downward arrow technique',
    category: 'cognitive',
    phaseTags: ['cognitive_restructuring'],
    description:
      'Successive "and what would that mean?" questions to uncover the underlying core belief.',
    estimatedDurationMin: 20,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'as_needed',
  },
  {
    id: 'cbt_evidence_for_against',
    title: 'Evidence for and against a hot thought',
    category: 'cognitive',
    phaseTags: ['cognitive_restructuring'],
    description:
      'List concrete evidence supporting and contradicting one belief; produce a balanced reframe.',
    estimatedDurationMin: 15,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },

  // --- Phase 4: behavioral_activation ---
  {
    id: 'cbt_activity_pleasure_mastery',
    title: 'Activity log with pleasure & mastery ratings',
    category: 'behavioral',
    phaseTags: ['behavioral_activation'],
    description:
      'Track hourly activities for 7 days with 0-10 pleasure + mastery ratings to map activation patterns.',
    estimatedDurationMin: 10,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },
  {
    id: 'cbt_behavioral_experiment',
    title: 'Behavioural experiment design + log',
    category: 'behavioral',
    phaseTags: ['behavioral_activation'],
    description:
      'Test a prediction: hypothesis, plan, result, what was learned. Pairs with cognitive restructuring.',
    estimatedDurationMin: 20,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },
  {
    id: 'cbt_exposure_ladder',
    title: 'Graded exposure hierarchy',
    category: 'behavioral',
    phaseTags: ['behavioral_activation'],
    description:
      'Build a 10-step fear ladder with SUDS ratings. Work upward at a tolerable pace. NOT to be assigned at high risk.',
    estimatedDurationMin: 30,
    riskGate: 'low_or_lower',
    responseSchema: 'exposure_log',
    cadence: 'weekly',
  },
  {
    id: 'cbt_problem_solving',
    title: '6-step problem solving',
    category: 'skill_building',
    phaseTags: ['behavioral_activation', 'cognitive_restructuring'],
    description:
      'Define problem → brainstorm → evaluate → choose → implement → review. For paralysis around concrete decisions.',
    estimatedDurationMin: 20,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'as_needed',
  },
  {
    id: 'cbt_sleep_hygiene_log',
    title: 'Sleep hygiene log',
    category: 'behavioral',
    phaseTags: ['behavioral_activation', 'psychoeducation'],
    description:
      'Track sleep window, screen time, caffeine, and morning mood for 7 nights. Standard adjunct for anxiety / mood.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'daily',
  },

  // --- Phase 5: consolidation_relapse_prevention ---
  {
    id: 'cbt_warning_signs_map',
    title: 'Early warning signs map',
    category: 'relapse_prevention',
    phaseTags: ['consolidation_relapse_prevention'],
    description:
      'Identify personal early warning signs (cognitive, emotional, behavioural, physical) that signal relapse risk.',
    estimatedDurationMin: 20,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_coping_card',
    title: 'Personal coping card',
    category: 'relapse_prevention',
    phaseTags: ['consolidation_relapse_prevention'],
    description:
      "Wallet-sized summary of the client's 5 most-used CBT tools and warning-sign responses.",
    estimatedDurationMin: 15,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_relapse_roadmap',
    title: 'Relapse-prevention roadmap',
    category: 'relapse_prevention',
    phaseTags: ['consolidation_relapse_prevention'],
    description:
      'Concrete plan with named contacts, helplines, coping steps, and re-entry triggers if relapse occurs.',
    estimatedDurationMin: 30,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'cbt_gain_summary_letter',
    title: 'Self-letter: what I learned in therapy',
    category: 'relapse_prevention',
    phaseTags: ['consolidation_relapse_prevention'],
    description:
      'Client writes a letter to their future self summarising gains, skills, and what to remember.',
    estimatedDurationMin: 30,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
] as const;

/** Lookup by id; throws on miss. Stable id contract — never rename ids. */
export function getCbtExerciseById(id: string): CbtExerciseDefinition {
  const found = CBT_EXERCISE_CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown CBT exercise id: ${id}`);
  return found;
}

export function listCbtExercisesByPhase(
  phase: CbtExerciseDefinition['phaseTags'][number],
): readonly CbtExerciseDefinition[] {
  return CBT_EXERCISE_CATALOG.filter((e) => e.phaseTags.includes(phase));
}
