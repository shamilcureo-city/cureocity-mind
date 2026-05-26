import type { TherapyNoteV1, WorkflowGoal } from '@cureocity/contracts';
import { CBT_PHASES, type CbtPhase, isCbtPhase, nextCbtPhase } from './phases';

export interface RecentNote {
  /** Validated TherapyNoteV1 from scribe-service Pass 2. */
  content: TherapyNoteV1 | null;
  /** When the session ended (used to weight recency). */
  endedAt: Date;
}

export interface AdvancementEvaluatorInput {
  currentPhase: string;
  /** Most recent sessions for this client in this workflow, newest-first. */
  recentNotes: RecentNote[];
  goals: WorkflowGoal[];
  /** Count of sessions while the workflow has been in `currentPhase`. */
  sessionsInCurrentPhase: number;
}

export interface AdvancementSignals {
  /** Did at least one phaseHint suggest a phase >= the canonical next phase? */
  phaseHintsAgreeAdvance: boolean;
  /** % of goals achieved at this phase. */
  goalAchievementRate: number;
  /** Number of sessions in the current phase. */
  sessionsInCurrentPhase: number;
  /** True if any recent note flagged severity >= 'high' — suppresses advance. */
  highRiskRecent: boolean;
  /** True if the minimum-sessions floor has been met for this phase. */
  minSessionsMet: boolean;
}

export interface AdvancementDecision {
  suggestedPhase: CbtPhase | null;
  confidence: number;
  rationale: string;
  signals: AdvancementSignals;
}

/**
 * Clinician-tunable defaults — pilot data will inform the right numbers.
 * Defer to therapist judgement; this is a SUGGESTION, never automatic.
 */
const MIN_SESSIONS_BY_PHASE: Record<CbtPhase, number> = {
  engagement_assessment: 1,
  psychoeducation: 1,
  cognitive_restructuring: 3,
  behavioral_activation: 3,
  consolidation_relapse_prevention: 2,
};

/**
 * Returns a phase-advancement suggestion based on session-count, goal
 * achievement, phaseHints, and risk severity. Always returns a
 * decision — `suggestedPhase=null` means "stay where you are".
 */
export function evaluateCbtAdvancement(input: AdvancementEvaluatorInput): AdvancementDecision {
  const signals = computeSignals(input);
  const phase = isCbtPhase(input.currentPhase) ? input.currentPhase : null;

  if (!phase) {
    return {
      suggestedPhase: null,
      confidence: 0,
      rationale: `Unknown CBT phase "${input.currentPhase}"; no suggestion possible`,
      signals,
    };
  }

  if (signals.highRiskRecent) {
    return {
      suggestedPhase: null,
      confidence: 0.8,
      rationale:
        'Recent session flagged high or critical risk. Do not advance the phase; address acute risk first.',
      signals,
    };
  }

  if (!signals.minSessionsMet) {
    return {
      suggestedPhase: null,
      confidence: 0.7,
      rationale: `Stay in ${phase} — minimum-sessions floor (${MIN_SESSIONS_BY_PHASE[phase]}) not yet met (${signals.sessionsInCurrentPhase} so far)`,
      signals,
    };
  }

  const next = nextCbtPhase(phase);
  if (!next) {
    return {
      suggestedPhase: null,
      confidence: 0.6,
      rationale:
        'Already at the final canonical phase. Consider terminating with a relapse-prevention plan if goals are met.',
      signals,
    };
  }

  // Composite confidence: phaseHints add 0.5, goals >= 60% add 0.3, sessions >= 2x floor add 0.2
  let confidence = 0;
  if (signals.phaseHintsAgreeAdvance) confidence += 0.5;
  if (signals.goalAchievementRate >= 0.6) confidence += 0.3;
  if (signals.sessionsInCurrentPhase >= MIN_SESSIONS_BY_PHASE[phase] * 2) confidence += 0.2;

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

function computeSignals(input: AdvancementEvaluatorInput): AdvancementSignals {
  const currentPhase = isCbtPhase(input.currentPhase) ? input.currentPhase : null;
  const sessionsInCurrentPhase = input.sessionsInCurrentPhase;
  const minSessionsMet =
    currentPhase !== null && sessionsInCurrentPhase >= MIN_SESSIONS_BY_PHASE[currentPhase];

  const goalAchievementRate =
    input.goals.length === 0
      ? 0
      : input.goals.filter((g) => g.achieved).length / input.goals.length;

  // High risk if any of the most recent 3 notes carry severity >= high
  const highRiskRecent = input.recentNotes
    .slice(0, 3)
    .some(
      (n) =>
        n.content?.riskFlags?.severity === 'high' || n.content?.riskFlags?.severity === 'critical',
    );

  // phaseHints agree if any recent note hints at a phase index >= nextCanonical
  const next = currentPhase ? nextCbtPhase(currentPhase) : null;
  const nextIdx = next ? CBT_PHASES.indexOf(next) : -1;
  const phaseHintsAgreeAdvance =
    nextIdx >= 0 &&
    input.recentNotes
      .slice(0, 3)
      .flatMap((n) => n.content?.phaseHints ?? [])
      .some((h) => {
        const hintedIdx = CBT_PHASES.indexOf(h.phase as CbtPhase);
        return hintedIdx >= nextIdx && h.confidence >= 0.6;
      });

  return {
    phaseHintsAgreeAdvance,
    goalAchievementRate,
    sessionsInCurrentPhase,
    highRiskRecent,
    minSessionsMet,
  };
}

function rationaleFor(from: CbtPhase, to: CbtPhase, signals: AdvancementSignals): string {
  const bits: string[] = [];
  if (signals.phaseHintsAgreeAdvance) bits.push('recent session note suggested advancement');
  if (signals.goalAchievementRate >= 0.6) {
    bits.push(`${(signals.goalAchievementRate * 100).toFixed(0)}% of goals achieved`);
  }
  if (signals.sessionsInCurrentPhase >= MIN_SESSIONS_BY_PHASE[from] * 2) {
    bits.push(`${signals.sessionsInCurrentPhase} sessions in ${from} (≥2× floor)`);
  }
  return `Advance from ${from} → ${to}: ${bits.join('; ')}`;
}

export { MIN_SESSIONS_BY_PHASE };
