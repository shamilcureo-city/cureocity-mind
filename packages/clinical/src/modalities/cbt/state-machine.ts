import { CBT_PHASES, isCbtPhase } from './phases';

export interface CbtTransitionResult {
  allowed: boolean;
  reason?: string;
  /** True if (from, to) is the canonical forward step (n → n+1). */
  isCanonicalForward?: boolean;
  /** True if the transition skips one or more phases forward (n → n+k, k>1). */
  isForwardSkip?: boolean;
  /** True if the transition goes backwards (n → m where m<n). */
  isRegression?: boolean;
}

/**
 * CBT phase transition rules.
 *
 * Allowed:
 *   - Canonical forward (n → n+1)
 *   - Skip-forward (n → n+k, k>1) — common when a brief intervention
 *     condenses phases
 *   - Regression (n → m, m<n) — rare, but allowed if the therapeutic
 *     alliance breaks or new presenting problems require re-formulation
 *   - Direct jump to consolidation_relapse_prevention — supports early
 *     termination
 *
 * Disallowed:
 *   - Same-phase no-op (handled at the service layer with a clearer error)
 *   - Unknown source or destination phase
 *
 * NOT enforced here: minimum-sessions-in-phase or risk-suppression gates.
 * Those live in the advancement-evaluator (signals-based suggestion).
 * A therapist can always override and transition manually with a reason.
 */
export function checkCbtTransition(from: string, to: string): CbtTransitionResult {
  if (!isCbtPhase(from)) {
    return { allowed: false, reason: `Unknown source phase "${from}"` };
  }
  if (!isCbtPhase(to)) {
    return { allowed: false, reason: `Unknown destination phase "${to}"` };
  }
  if (from === to) {
    return { allowed: false, reason: 'Source and destination phases are the same' };
  }

  const fromIdx = CBT_PHASES.indexOf(from);
  const toIdx = CBT_PHASES.indexOf(to);
  const result: CbtTransitionResult = { allowed: true };

  if (toIdx === fromIdx + 1) {
    result.isCanonicalForward = true;
  } else if (toIdx > fromIdx) {
    result.isForwardSkip = true;
  } else {
    result.isRegression = true;
  }

  return result;
}

export { CBT_PHASES, CBT_INITIAL_PHASE, nextCbtPhase, isCbtPhase } from './phases';
export type { CbtPhase } from './phases';
