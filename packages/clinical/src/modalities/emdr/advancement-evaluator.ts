import type { TherapyNoteV1, WorkflowGoal } from '@cureocity/contracts';
import { EMDR_PHASES, type EmdrPhase, isEmdrPhase, nextEmdrPhase } from './phases';

/**
 * EMDR advancement evaluator — same shape as the CBT evaluator
 * (advancement-evaluator.ts) but tuned to EMDR's 8-phase model and
 * its gating semantics (preparation must be complete before
 * assessment; at least one target must exist before desensitization).
 *
 * Inputs we use:
 *   - currentPhase + sessionsInCurrentPhase + min-floor
 *   - goals achievement rate (same as CBT)
 *   - phaseHints from recent TherapyNotes (Pass 2 emits these)
 *   - high-risk-recent suppresses any advance (same as CBT)
 *   - EMDR-specific gates: preparationComplete + hasTargets passed
 *     in via the state context so phase 2→3 and 2→4+ aren't
 *     accidentally green-lit
 */

export interface EmdrRecentNote {
  content: TherapyNoteV1 | null;
  endedAt: Date;
}

export interface EmdrAdvancementEvaluatorInput {
  currentPhase: string;
  recentNotes: EmdrRecentNote[];
  goals: WorkflowGoal[];
  sessionsInCurrentPhase: number;
  preparationComplete: boolean;
  hasTargets: boolean;
}

export interface EmdrAdvancementSignals {
  phaseHintsAgreeAdvance: boolean;
  goalAchievementRate: number;
  sessionsInCurrentPhase: number;
  highRiskRecent: boolean;
  minSessionsMet: boolean;
  preparationComplete: boolean;
  hasTargets: boolean;
}

export interface EmdrAdvancementDecision {
  suggestedPhase: EmdrPhase | null;
  confidence: number;
  rationale: string;
  signals: EmdrAdvancementSignals;
}

/** Min sessions in each phase before suggesting advance. Tunable per pilot. */
const EMDR_MIN_SESSIONS_BY_PHASE: Record<EmdrPhase, number> = {
  history_taking: 1,
  preparation: 2,
  assessment: 1,
  desensitization: 3,
  installation: 1,
  body_scan: 1,
  closure: 1,
  reevaluation: 1,
};

export function evaluateEmdrAdvancement(
  input: EmdrAdvancementEvaluatorInput,
): EmdrAdvancementDecision {
  const signals = computeSignals(input);
  const phase = isEmdrPhase(input.currentPhase) ? input.currentPhase : null;

  if (!phase) {
    return {
      suggestedPhase: null,
      confidence: 0,
      rationale: `Unknown EMDR phase "${input.currentPhase}"`,
      signals,
    };
  }

  if (signals.highRiskRecent) {
    return {
      suggestedPhase: null,
      confidence: 0.8,
      rationale:
        'Recent session flagged high or critical risk. Stay in current phase; address acute risk before advancing.',
      signals,
    };
  }

  if (!signals.minSessionsMet) {
    return {
      suggestedPhase: null,
      confidence: 0.7,
      rationale: `Stay in ${phase} — minimum-sessions floor (${EMDR_MIN_SESSIONS_BY_PHASE[phase]}) not yet met (${signals.sessionsInCurrentPhase} so far)`,
      signals,
    };
  }

  const next = nextEmdrPhase(phase);
  if (!next) {
    return {
      suggestedPhase: null,
      confidence: 0.6,
      rationale: 'Already at the final canonical EMDR phase (reevaluation).',
      signals,
    };
  }

  // EMDR-specific gates: prep must be complete to advance past
  // preparation; at least one target must exist to advance past
  // assessment.
  if (phase === 'preparation' && !signals.preparationComplete) {
    return {
      suggestedPhase: null,
      confidence: 0.9,
      rationale:
        'Cannot advance from preparation: safe-place installation, resource development, and dissociation screen are not all marked complete.',
      signals,
    };
  }
  if (phase === 'assessment' && !signals.hasTargets) {
    return {
      suggestedPhase: null,
      confidence: 0.9,
      rationale:
        'Cannot advance from assessment to desensitization: no target memories have been identified yet.',
      signals,
    };
  }

  let confidence = 0;
  if (signals.phaseHintsAgreeAdvance) confidence += 0.5;
  if (signals.goalAchievementRate >= 0.6) confidence += 0.3;
  if (signals.sessionsInCurrentPhase >= EMDR_MIN_SESSIONS_BY_PHASE[phase] * 2) confidence += 0.2;

  if (confidence === 0) {
    return {
      suggestedPhase: null,
      confidence: 0.5,
      rationale: `Stay in ${phase} — no clear signals of readiness (goal achievement ${(signals.goalAchievementRate * 100).toFixed(0)}%, ${signals.sessionsInCurrentPhase} sessions)`,
      signals,
    };
  }

  return {
    suggestedPhase: next,
    confidence: Math.min(confidence, 1),
    rationale: rationaleFor(phase, next, signals),
    signals,
  };
}

function computeSignals(input: EmdrAdvancementEvaluatorInput): EmdrAdvancementSignals {
  const currentPhase = isEmdrPhase(input.currentPhase) ? input.currentPhase : null;
  const sessionsInCurrentPhase = input.sessionsInCurrentPhase;
  const minSessionsMet =
    currentPhase !== null && sessionsInCurrentPhase >= EMDR_MIN_SESSIONS_BY_PHASE[currentPhase];

  const goalAchievementRate =
    input.goals.length === 0 ? 0 : input.goals.filter((g) => g.achieved).length / input.goals.length;

  const highRiskRecent = input.recentNotes
    .slice(0, 3)
    .some(
      (n) =>
        n.content?.riskFlags?.severity === 'high' || n.content?.riskFlags?.severity === 'critical',
    );

  const next = currentPhase ? nextEmdrPhase(currentPhase) : null;
  const nextIdx = next ? EMDR_PHASES.indexOf(next) : -1;
  const phaseHintsAgreeAdvance =
    nextIdx >= 0 &&
    input.recentNotes
      .slice(0, 3)
      .flatMap((n) => n.content?.phaseHints ?? [])
      .some((h) => {
        const hintedIdx = EMDR_PHASES.indexOf(h.phase as EmdrPhase);
        return hintedIdx >= nextIdx && h.confidence >= 0.6;
      });

  return {
    phaseHintsAgreeAdvance,
    goalAchievementRate,
    sessionsInCurrentPhase,
    highRiskRecent,
    minSessionsMet,
    preparationComplete: input.preparationComplete,
    hasTargets: input.hasTargets,
  };
}

function rationaleFor(
  from: EmdrPhase,
  to: EmdrPhase,
  signals: EmdrAdvancementSignals,
): string {
  const bits: string[] = [];
  if (signals.phaseHintsAgreeAdvance) bits.push('recent session note suggested advancement');
  if (signals.goalAchievementRate >= 0.6) {
    bits.push(`${(signals.goalAchievementRate * 100).toFixed(0)}% of goals achieved`);
  }
  if (signals.sessionsInCurrentPhase >= EMDR_MIN_SESSIONS_BY_PHASE[from] * 2) {
    bits.push(`${signals.sessionsInCurrentPhase} sessions in ${from} (≥2× floor)`);
  }
  return `Advance from ${from} → ${to}: ${bits.join('; ')}`;
}

export { EMDR_MIN_SESSIONS_BY_PHASE };
