import { z } from 'zod';
import {
  ClinicalTreatmentPlanSchema,
  type ClinicalPlanSuggestion,
  type ClinicalTreatmentPlan,
} from '@cureocity/contracts';

export const PlanSuggestionStateSchema = z.object({
  revision: z.string().min(1),
  basePlanId: z.string().min(1),
  currentPlanId: z.string().min(1),
  basePlan: ClinicalTreatmentPlanSchema,
  appliedIndexes: z.array(z.number().int().nonnegative()),
});
export type PlanSuggestionState = z.infer<typeof PlanSuggestionStateSchema>;

export function createPlanSuggestionState(
  plan: { id: string; body: unknown } | null,
  revision: string,
): PlanSuggestionState | null {
  if (!plan) return null;
  const parsed = ClinicalTreatmentPlanSchema.safeParse(plan.body);
  return parsed.success
    ? {
        revision,
        basePlanId: plan.id,
        currentPlanId: plan.id,
        basePlan: parsed.data,
        appliedIndexes: [],
      }
    : null;
}

/** Always apply the cumulative set against the immutable original plan. A goal's
 * index is scoped to that stable base plan ID, never the evolving current plan. */
export function resolvePlanSuggestionDecision(args: {
  state: PlanSuggestionState;
  suggestions: ClinicalPlanSuggestion[];
  requestedIndexes: number[];
  revision?: string;
  expectedPlanId?: string;
  activePlanId: string;
}): { plan: ClinicalTreatmentPlan; appliedIndexes: number[]; duplicate: boolean } {
  const { state } = args;
  if (args.revision !== state.revision)
    throw new Error(
      'These suggestions have changed. Reload the clinical context before applying them.',
    );
  const requested = [...new Set(args.requestedIndexes)];
  if (!requested.length || requested.some((i) => !args.suggestions[i]))
    throw new Error('Suggestion index out of range.');
  const duplicate = requested.every((i) => state.appliedIndexes.includes(i));
  if (
    !duplicate &&
    (args.expectedPlanId !== state.currentPlanId || args.activePlanId !== state.currentPlanId)
  ) {
    throw new Error(
      'The treatment plan changed. Refresh the clinical analysis before applying further suggestions.',
    );
  }
  const appliedIndexes = [...new Set([...state.appliedIndexes, ...requested])].sort(
    (a, b) => a - b,
  );
  const chosen = appliedIndexes.map((i) => args.suggestions[i]!);
  const targetedGoals = chosen
    .filter((suggestion) => suggestion.type === 'REVISE_GOAL' || suggestion.type === 'REMOVE_GOAL')
    .map((suggestion) => suggestion.goalIndex);
  if (new Set(targetedGoals).size !== targetedGoals.length)
    throw new Error(
      'These suggestions conflict on the same goal. Edit the plan directly or regenerate the clinical analysis.',
    );
  // Scalar proposals also target one stable setting. Replaying cumulative
  // indexes must never mark a second proposal applied while the first wins.
  for (const type of ['ADJUST_DURATION', 'CHANGE_MODALITY'] as const) {
    if (chosen.filter((suggestion) => suggestion.type === type).length > 1) {
      const setting = type === 'ADJUST_DURATION' ? 'treatment duration' : 'treatment modality';
      throw new Error(
        `These suggestions conflict on ${setting}. Keep one proposal, or edit the plan directly and regenerate the clinical analysis.`,
      );
    }
  }
  const revises = chosen.filter((s) => s.type === 'REVISE_GOAL');
  const removes = chosen
    .filter((s) => s.type === 'REMOVE_GOAL')
    .sort((a, b) => (b.goalIndex ?? 0) - (a.goalIndex ?? 0));
  const rest = chosen.filter((s) => s.type !== 'REVISE_GOAL' && s.type !== 'REMOVE_GOAL');
  let plan = structuredClone(state.basePlan);
  for (const suggestion of [...revises, ...removes, ...rest]) {
    plan = applySuggestion(plan, suggestion);
  }
  return { plan: ClinicalTreatmentPlanSchema.parse(plan), appliedIndexes, duplicate };
}

function applySuggestion(
  plan: ClinicalTreatmentPlan,
  s: ClinicalPlanSuggestion,
): ClinicalTreatmentPlan {
  const goals = [...plan.goals];
  switch (s.type) {
    case 'ADD_GOAL':
      if (!s.goal || goals.length >= 8)
        throw new Error('Cannot add this goal: missing content or plan already has eight goals.');
      goals.push(s.goal);
      return { ...plan, goals };
    case 'REVISE_GOAL':
      if (!s.goal || s.goalIndex === null || s.goalIndex >= goals.length)
        throw new Error('The goal to revise is no longer available.');
      goals[s.goalIndex] = s.goal;
      return { ...plan, goals };
    case 'REMOVE_GOAL':
      if (s.goalIndex === null || s.goalIndex >= goals.length || goals.length <= 1)
        throw new Error('Cannot remove this goal; a plan must retain at least one goal.');
      goals.splice(s.goalIndex, 1);
      return { ...plan, goals };
    case 'ADJUST_DURATION':
      if (s.expectedDurationSessions === null) throw new Error('No proposed duration.');
      return { ...plan, expectedDurationSessions: s.expectedDurationSessions };
    case 'CHANGE_MODALITY':
      if (s.modality === null) throw new Error('No proposed modality.');
      return { ...plan, modality: s.modality };
  }
}
