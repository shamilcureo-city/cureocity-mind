import { EMDR_PHASES, isEmdrPhase } from './phases';

export interface EmdrTransitionResult {
  allowed: boolean;
  reason?: string;
  isCanonicalForward?: boolean;
  isForwardSkip?: boolean;
  isRegression?: boolean;
}

export interface EmdrTransitionContext {
  /**
   * True if the client has completed Phase 2 prerequisites (safe-place
   * installation + resource development + dissociation screen).
   * Required for any transition INTO `assessment` or later.
   */
  preparationComplete: boolean;
  /**
   * True if at least one target memory has been added to the workflow.
   * Required for any transition INTO `desensitization` or later.
   */
  hasTargets: boolean;
}

/**
 * EMDR phase transitions.
 *
 * Allowed:
 *   - Canonical forward (n → n+1)
 *   - Skip-forward (n → n+k, k>1) only when gates pass
 *   - Regression to earlier phases (always — clinician judgement)
 *   - `closure` is a special case: reachable from any active phase
 *     because every session ends with closure regardless of in-progress
 *     reprocessing
 *
 * Gates (hard):
 *   - Any transition INTO assessment | desensitization | installation |
 *     body_scan REQUIRES preparationComplete=true (Phase 2 gate)
 *   - Any transition INTO desensitization | installation | body_scan
 *     REQUIRES at least one target memory
 *
 * Disallowed:
 *   - Same-phase no-op
 *   - Unknown source / destination
 */
export function checkEmdrTransition(
  from: string,
  to: string,
  ctx: EmdrTransitionContext,
): EmdrTransitionResult {
  if (!isEmdrPhase(from)) {
    return { allowed: false, reason: `Unknown source phase "${from}"` };
  }
  if (!isEmdrPhase(to)) {
    return { allowed: false, reason: `Unknown destination phase "${to}"` };
  }
  if (from === to) {
    return { allowed: false, reason: 'Source and destination phases are the same' };
  }

  const PREPARATION_GATED: ReadonlyArray<string> = [
    'assessment',
    'desensitization',
    'installation',
    'body_scan',
  ];
  const TARGETS_GATED: ReadonlyArray<string> = ['desensitization', 'installation', 'body_scan'];

  if (PREPARATION_GATED.includes(to) && !ctx.preparationComplete) {
    return {
      allowed: false,
      reason: `Phase 2 (preparation) must be marked complete before transitioning to "${to}"`,
    };
  }
  if (TARGETS_GATED.includes(to) && !ctx.hasTargets) {
    return {
      allowed: false,
      reason: `At least one target memory must be added before transitioning to "${to}"`,
    };
  }

  const fromIdx = EMDR_PHASES.indexOf(from);
  const toIdx = EMDR_PHASES.indexOf(to);
  const result: EmdrTransitionResult = { allowed: true };

  if (toIdx === fromIdx + 1) result.isCanonicalForward = true;
  else if (toIdx > fromIdx) result.isForwardSkip = true;
  else result.isRegression = true;

  return result;
}

export { EMDR_PHASES, EMDR_INITIAL_PHASE, nextEmdrPhase, isEmdrPhase } from './phases';
export type { EmdrPhase } from './phases';
