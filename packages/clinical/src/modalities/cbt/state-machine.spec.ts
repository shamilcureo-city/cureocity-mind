import { describe, it, expect } from 'vitest';
import { checkCbtTransition, CBT_PHASES, nextCbtPhase } from './state-machine';

describe('checkCbtTransition', () => {
  it('allows canonical forward step', () => {
    const r = checkCbtTransition('engagement_assessment', 'psychoeducation');
    expect(r.allowed).toBe(true);
    expect(r.isCanonicalForward).toBe(true);
  });

  it('allows forward skip', () => {
    const r = checkCbtTransition('engagement_assessment', 'behavioral_activation');
    expect(r.allowed).toBe(true);
    expect(r.isForwardSkip).toBe(true);
  });

  it('allows regression', () => {
    const r = checkCbtTransition('cognitive_restructuring', 'engagement_assessment');
    expect(r.allowed).toBe(true);
    expect(r.isRegression).toBe(true);
  });

  it('allows early jump to consolidation', () => {
    const r = checkCbtTransition('psychoeducation', 'consolidation_relapse_prevention');
    expect(r.allowed).toBe(true);
    expect(r.isForwardSkip).toBe(true);
  });

  it('rejects same-phase no-op', () => {
    const r = checkCbtTransition('engagement_assessment', 'engagement_assessment');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/same/i);
  });

  it('rejects unknown phases', () => {
    expect(checkCbtTransition('nope', 'engagement_assessment').allowed).toBe(false);
    expect(checkCbtTransition('engagement_assessment', 'nope').allowed).toBe(false);
  });
});

describe('nextCbtPhase', () => {
  it('returns the canonical next phase', () => {
    expect(nextCbtPhase('engagement_assessment')).toBe('psychoeducation');
    expect(nextCbtPhase('behavioral_activation')).toBe('consolidation_relapse_prevention');
  });

  it('returns null at the terminal phase', () => {
    expect(nextCbtPhase('consolidation_relapse_prevention')).toBeNull();
  });
});

describe('CBT_PHASES', () => {
  it('has exactly 5 phases', () => {
    expect(CBT_PHASES.length).toBe(5);
  });

  it('starts with engagement_assessment and ends with consolidation_relapse_prevention', () => {
    expect(CBT_PHASES[0]).toBe('engagement_assessment');
    expect(CBT_PHASES[4]).toBe('consolidation_relapse_prevention');
  });
});
