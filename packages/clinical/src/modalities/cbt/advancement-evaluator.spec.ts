import { describe, it, expect } from 'vitest';
import type { TherapyNoteV1, WorkflowGoal } from '@cureocity/contracts';
import { evaluateCbtAdvancement, type RecentNote } from './advancement-evaluator';

function makeNote(opts: {
  severity?: TherapyNoteV1['riskFlags']['severity'];
  phaseHints?: TherapyNoteV1['phaseHints'];
}): RecentNote {
  return {
    content: {
      version: 'V1',
      modality: 'CBT',
      subjective: 's',
      objective: 'o',
      assessment: 'a',
      plan: 'p',
      riskFlags: { severity: opts.severity ?? 'none', indicators: [] },
      phaseHints: opts.phaseHints ?? [],
      linkedEvidence: [],
    },
    endedAt: new Date(),
  };
}

const TWO_GOALS_ONE_ACHIEVED: WorkflowGoal[] = [
  { id: 'g1', description: 'Reduce anxiety', achieved: true },
  { id: 'g2', description: 'Improve sleep', achieved: false },
];

describe('evaluateCbtAdvancement', () => {
  it('suggests advance when phaseHints agree + goals achieved + sessions met', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'engagement_assessment',
      recentNotes: [makeNote({ phaseHints: [{ phase: 'psychoeducation', confidence: 0.8 }] })],
      goals: [{ id: 'g1', description: 'x', achieved: true }],
      sessionsInCurrentPhase: 2,
    });
    expect(decision.suggestedPhase).toBe('psychoeducation');
    expect(decision.confidence).toBeGreaterThan(0.7);
  });

  it('blocks advancement when most recent note flagged high risk', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'cognitive_restructuring',
      recentNotes: [
        makeNote({
          severity: 'high',
          phaseHints: [{ phase: 'behavioral_activation', confidence: 0.9 }],
        }),
      ],
      goals: TWO_GOALS_ONE_ACHIEVED,
      sessionsInCurrentPhase: 5,
    });
    expect(decision.suggestedPhase).toBeNull();
    expect(decision.rationale).toMatch(/risk/i);
  });

  it('blocks when min-sessions floor not met', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'cognitive_restructuring', // floor=3
      recentNotes: [
        makeNote({ phaseHints: [{ phase: 'behavioral_activation', confidence: 0.9 }] }),
      ],
      goals: [{ id: 'g1', description: 'x', achieved: true }],
      sessionsInCurrentPhase: 1,
    });
    expect(decision.suggestedPhase).toBeNull();
    expect(decision.rationale).toMatch(/minimum-sessions/i);
  });

  it('returns null suggestion at the terminal phase', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'consolidation_relapse_prevention',
      recentNotes: [],
      goals: [],
      sessionsInCurrentPhase: 5,
    });
    expect(decision.suggestedPhase).toBeNull();
    expect(decision.rationale).toMatch(/final canonical phase/i);
  });

  it('returns null when current phase is unknown', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'made_up_phase',
      recentNotes: [],
      goals: [],
      sessionsInCurrentPhase: 99,
    });
    expect(decision.suggestedPhase).toBeNull();
    expect(decision.rationale).toMatch(/Unknown CBT phase/);
  });

  it('returns null when no clear signals (no phaseHints, low goals, near-floor sessions)', () => {
    const decision = evaluateCbtAdvancement({
      currentPhase: 'cognitive_restructuring', // floor=3
      recentNotes: [makeNote({})],
      goals: [
        { id: 'g1', description: 'x', achieved: false },
        { id: 'g2', description: 'y', achieved: false },
      ],
      sessionsInCurrentPhase: 3,
    });
    expect(decision.suggestedPhase).toBeNull();
    expect(decision.signals.phaseHintsAgreeAdvance).toBe(false);
    expect(decision.signals.goalAchievementRate).toBe(0);
  });
});
