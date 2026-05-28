import { describe, it, expect } from 'vitest';
import { CBT_INITIAL_PHASE, CBT_PHASE_DESCRIPTIONS, isCbtPhase, CBT_PHASES } from './phases';

describe('CBT phases', () => {
  it('has a description for every phase', () => {
    for (const phase of CBT_PHASES) {
      expect(CBT_PHASE_DESCRIPTIONS[phase]).toBeTruthy();
    }
  });

  it('CBT_INITIAL_PHASE is engagement_assessment', () => {
    expect(CBT_INITIAL_PHASE).toBe('engagement_assessment');
  });

  it('isCbtPhase narrows correctly', () => {
    expect(isCbtPhase('engagement_assessment')).toBe(true);
    expect(isCbtPhase('not_a_phase')).toBe(false);
    expect(isCbtPhase(42)).toBe(false);
    expect(isCbtPhase(null)).toBe(false);
  });
});
