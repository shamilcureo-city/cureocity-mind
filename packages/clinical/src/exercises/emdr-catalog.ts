import type { CbtExerciseDefinition } from './types';

/**
 * 20 EMDR exercises. Same shape as CBT catalog so the prescription engine
 * can be modality-agnostic later. PRD 22.1 Appendix D is the canonical
 * source. Stable ids — never rename; Sprint 5 localisation keys off them.
 *
 * EMDR-specific notes:
 *   - Many exercises are clinician-led in-session, not homework. We still
 *     model them as catalog entries so the prescription engine + audit
 *     log have something to reference.
 *   - Bilateral-stimulation work is NEVER prescribed for at-home practice;
 *     all entries below are either preparation/closure resources or
 *     between-session journaling / grounding. Reprocessing must remain
 *     in-session with a clinician.
 *
 * We reuse the CBT exercise shape (cbt prefix → emdr prefix for ids;
 * phaseTags use a string union we treat as opaque — the prescription
 * engine in PR 4 of Sprint 3 only knows CBT phases. EMDR prescription
 * lands in Sprint 5 once continuity-service ships).
 *
 * TYPE NOTE: phaseTags is typed CbtPhase[] in the shared type. We cast
 * EMDR phase strings via `as unknown as CbtPhase[]` so the catalog
 * compiles without expanding the union. The dedicated EMDR
 * prescription engine (Sprint 5) re-narrows.
 */
type EmdrPhaseTag =
  | 'history_taking'
  | 'preparation'
  | 'assessment'
  | 'desensitization'
  | 'installation'
  | 'body_scan'
  | 'closure'
  | 'reevaluation';

function emdrPhases(...tags: EmdrPhaseTag[]): CbtExerciseDefinition['phaseTags'] {
  return tags as unknown as CbtExerciseDefinition['phaseTags'];
}

export const EMDR_EXERCISE_CATALOG: readonly CbtExerciseDefinition[] = [
  // --- Phase 1: history_taking ---
  {
    id: 'emdr_history_form',
    title: 'EMDR client history intake form',
    category: 'skill_building',
    phaseTags: emdrPhases('history_taking'),
    description:
      'Structured intake covering symptom history, prior trauma, current stressors, and EMDR readiness markers.',
    estimatedDurationMin: 30,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'emdr_target_brainstorm',
    title: 'Past / present / future target brainstorm',
    category: 'skill_building',
    phaseTags: emdrPhases('history_taking'),
    description:
      'Three-column worksheet to identify candidate past memories, present triggers, and future-template targets.',
    estimatedDurationMin: 20,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'emdr_des_screening',
    title: 'Dissociation screening (DES-II)',
    category: 'outcome_measure',
    phaseTags: emdrPhases('history_taking'),
    description:
      '28-item Dissociative Experiences Scale; flags need for slower preparation if elevated.',
    estimatedDurationMin: 15,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },

  // --- Phase 2: preparation ---
  {
    id: 'emdr_safe_place_installation',
    title: 'Safe / calm place installation',
    category: 'skill_building',
    phaseTags: emdrPhases('preparation'),
    description:
      'Guide client to imagine a safe place; pair with slow bilateral taps; install cue word. Cornerstone preparation resource.',
    estimatedDurationMin: 30,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'one_shot',
  },
  {
    id: 'emdr_resource_team',
    title: 'Resource team installation',
    category: 'skill_building',
    phaseTags: emdrPhases('preparation'),
    description:
      'Identify and install nurturing / protective / wise figures (real or imaginal) as additional internal resources.',
    estimatedDurationMin: 30,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'as_needed',
  },
  {
    id: 'emdr_container_exercise',
    title: 'Container exercise',
    category: 'skill_building',
    phaseTags: emdrPhases('preparation', 'closure'),
    description:
      'Imaginal container to temporarily hold unresolved material between sessions. Pair with bilateral closure.',
    estimatedDurationMin: 15,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'as_needed',
  },
  {
    id: 'emdr_grounding_5_4_3_2_1',
    title: 'Grounding: 5-4-3-2-1 senses',
    category: 'skill_building',
    phaseTags: emdrPhases('preparation', 'closure'),
    description:
      'Name 5 things you see, 4 you hear, 3 you feel, 2 you smell, 1 you taste. Quick return to the present.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'daily',
  },

  // --- Phase 3: assessment (clinician-led; minimal client homework) ---
  {
    id: 'emdr_assessment_worksheet',
    title: 'Target assessment worksheet (NC, PC, VOC, SUDS)',
    category: 'cognitive',
    phaseTags: emdrPhases('assessment'),
    description:
      'Captures the four canonical EMDR fields for one target: NC, PC, VOC (1-7), SUDS (0-10), plus emotion + body location.',
    estimatedDurationMin: 20,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'as_needed',
  },

  // --- Phase 4: desensitization (in-session only) ---
  {
    id: 'emdr_between_session_journal',
    title: 'Between-session reprocessing journal',
    category: 'cognitive',
    phaseTags: emdrPhases('desensitization', 'installation'),
    description:
      'Log between-session associations, dreams, somatic shifts. Brings the data to the next reprocessing session.',
    estimatedDurationMin: 10,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'daily',
  },
  {
    id: 'emdr_suds_check_in',
    title: 'Daily SUDS check-in',
    category: 'outcome_measure',
    phaseTags: emdrPhases('desensitization'),
    description:
      'Quick 0-10 rating of distress around the active target. Tracks reprocessing stability between sessions.',
    estimatedDurationMin: 2,
    riskGate: 'medium_or_lower',
    responseSchema: 'mood_rating_0_10',
    cadence: 'daily',
  },
  {
    id: 'emdr_trigger_log',
    title: 'Present-trigger log',
    category: 'cognitive',
    phaseTags: emdrPhases('desensitization', 'reevaluation'),
    description:
      'Note when target-related triggers fire; rate intensity 0-10; bring to next session for incorporation.',
    estimatedDurationMin: 5,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'daily',
  },

  // --- Phase 5: installation (in-session, with brief journal) ---
  {
    id: 'emdr_pc_strengthening_journal',
    title: 'PC strengthening journal',
    category: 'cognitive',
    phaseTags: emdrPhases('installation'),
    description:
      'Record evidence supporting the Positive Cognition between sessions; reinforces VOC consolidation.',
    estimatedDurationMin: 10,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },

  // --- Phase 6: body_scan ---
  {
    id: 'emdr_body_scan_practice',
    title: 'Daily body scan',
    category: 'skill_building',
    phaseTags: emdrPhases('body_scan', 'closure'),
    description:
      'Mindful body scan from head to feet, noting tension. Use breath to release. 10 min audio guide.',
    estimatedDurationMin: 10,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'daily',
  },

  // --- Phase 7: closure (between-session stabilisation) ---
  {
    id: 'emdr_closure_diary',
    title: 'Closure diary',
    category: 'skill_building',
    phaseTags: emdrPhases('closure', 'desensitization'),
    description:
      'After session: 3 lines noting state, then safe-place / container as needed. Use whenever destabilised.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'as_needed',
  },
  {
    id: 'emdr_bilateral_self_tap',
    title: 'Self-tap bilateral stabilisation (butterfly hug)',
    category: 'skill_building',
    phaseTags: emdrPhases('closure', 'preparation'),
    description:
      'Cross arms, alternate taps on shoulders; pair with safe place. SELF-soothing only — never for reprocessing.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'binary_completed',
    cadence: 'as_needed',
  },

  // --- Phase 8: reevaluation ---
  {
    id: 'emdr_target_stability_check',
    title: 'Target stability check (SUDS / VOC)',
    category: 'outcome_measure',
    phaseTags: emdrPhases('reevaluation'),
    description:
      'Re-rate SUDS + VOC on previously-resolved targets to detect regression or new associations.',
    estimatedDurationMin: 10,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },
  {
    id: 'emdr_future_template_rehearsal',
    title: 'Future-template rehearsal',
    category: 'behavioral',
    phaseTags: emdrPhases('reevaluation', 'installation'),
    description:
      'Imagine a future challenging situation with the PC active; rate confidence; identify additional resources needed.',
    estimatedDurationMin: 15,
    riskGate: 'medium_or_lower',
    responseSchema: 'free_text',
    cadence: 'weekly',
  },

  // --- Outcome measures spanning multiple phases ---
  {
    id: 'emdr_intake_pcl5',
    title: 'PCL-5 PTSD severity',
    category: 'outcome_measure',
    phaseTags: emdrPhases('history_taking', 'reevaluation'),
    description: '20-item PTSD Checklist for DSM-5 — baseline + endpoint comparison.',
    estimatedDurationMin: 10,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'emdr_intake_ies_r',
    title: 'IES-R Impact of Event Scale',
    category: 'outcome_measure',
    phaseTags: emdrPhases('history_taking', 'reevaluation'),
    description:
      '22-item Impact of Event Scale — Revised; tracks intrusion / avoidance / hyperarousal.',
    estimatedDurationMin: 10,
    riskGate: 'always_safe',
    responseSchema: 'free_text',
    cadence: 'one_shot',
  },
  {
    id: 'emdr_phq9_screen',
    title: 'PHQ-9 (depression co-screen)',
    category: 'outcome_measure',
    phaseTags: emdrPhases('history_taking', 'reevaluation'),
    description: 'PHQ-9 to track depressive symptoms alongside trauma reprocessing.',
    estimatedDurationMin: 5,
    riskGate: 'always_safe',
    responseSchema: 'phq9',
    cadence: 'one_shot',
  },
] as const;

export function getEmdrExerciseById(id: string): CbtExerciseDefinition {
  const found = EMDR_EXERCISE_CATALOG.find((e) => e.id === id);
  if (!found) throw new Error(`Unknown EMDR exercise id: ${id}`);
  return found;
}
