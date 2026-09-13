import { EMDR_INITIAL_PHASE, EMDR_PHASES, isEmdrPhase } from './phases';

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
   * Required for assessment, desensitization, installation and body_scan.
   */
  preparationComplete: boolean;
  /**
   * True if at least one target memory has been added to the workflow.
   * Required for desensitization, installation and body_scan.
   */
  hasTargets: boolean;
}

/** Existing destination gates, shared by transitions, creation and review. */
export function checkEmdrPhasePrerequisites(
  phase: string,
  ctx: EmdrTransitionContext,
): EmdrTransitionResult {
  if (!isEmdrPhase(phase)) {
    return { allowed: false, reason: `Unknown destination phase "${phase}"` };
  }
  const preparationGated: readonly string[] = [
    'assessment',
    'desensitization',
    'installation',
    'body_scan',
  ];
  const targetsGated: readonly string[] = ['desensitization', 'installation', 'body_scan'];

  if (preparationGated.includes(phase) && !ctx.preparationComplete) {
    return {
      allowed: false,
      reason: `Preparation completion is not recorded for phase "${phase}".`,
    };
  }
  if (targetsGated.includes(phase) && !ctx.hasTargets) {
    return {
      allowed: false,
      reason: `A target memory is not recorded for phase "${phase}".`,
    };
  }
  return { allowed: true };
}

/**
 * New workflows have no recorded prerequisites. Prior-care entry is not
 * supported: it needs a separately reviewed evidence policy, not supplied flags.
 * This restricts creation only; it does not reclassify historical workflows.
 */
export function checkEmdrWorkflowStart(phase: string): EmdrTransitionResult {
  const prerequisites = checkEmdrPhasePrerequisites(phase, {
    preparationComplete: false,
    hasTargets: false,
  });
  if (!prerequisites.allowed) return prerequisites;
  if (phase !== EMDR_INITIAL_PHASE) {
    return {
      allowed: false,
      reason: 'New EMDR workflows must start at history taking. Prior-care entry is not available.',
    };
  }
  return { allowed: true };
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

  const prerequisites = checkEmdrPhasePrerequisites(to, ctx);
  if (!prerequisites.allowed) return prerequisites;

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
