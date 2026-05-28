import { describe, it, expect } from 'vitest';
import {
  EMDR_PHASES,
  EMDR_INITIAL_PHASE,
  EMDR_PHASE_DESCRIPTIONS,
  isEmdrPhase,
  nextEmdrPhase,
} from './phases';
import { checkEmdrTransition } from './state-machine';

const PREP_DONE = { preparationComplete: true, hasTargets: true };
const PREP_NOT_DONE = { preparationComplete: false, hasTargets: false };

describe('EMDR phases', () => {
  it('has exactly 8 phases starting with history_taking and ending with reevaluation', () => {
    expect(EMDR_PHASES.length).toBe(8);
    expect(EMDR_PHASES[0]).toBe('history_taking');
    expect(EMDR_PHASES[7]).toBe('reevaluation');
  });

  it('EMDR_INITIAL_PHASE is history_taking', () => {
    expect(EMDR_INITIAL_PHASE).toBe('history_taking');
  });

  it('every phase has a description', () => {
    for (const p of EMDR_PHASES) expect(EMDR_PHASE_DESCRIPTIONS[p]).toBeTruthy();
  });

  it('isEmdrPhase narrows correctly', () => {
    expect(isEmdrPhase('preparation')).toBe(true);
    expect(isEmdrPhase('engagement_assessment')).toBe(false);
    expect(isEmdrPhase(42)).toBe(false);
  });

  it('nextEmdrPhase walks the canonical order', () => {
    expect(nextEmdrPhase('history_taking')).toBe('preparation');
    expect(nextEmdrPhase('preparation')).toBe('assessment');
    expect(nextEmdrPhase('reevaluation')).toBeNull();
  });
});

describe('checkEmdrTransition — Phase 2 gate', () => {
  it('rejects history_taking → assessment when preparation not complete', () => {
    const r = checkEmdrTransition('history_taking', 'assessment', PREP_NOT_DONE);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/preparation/i);
  });

  it('allows history_taking → assessment after preparation', () => {
    const r = checkEmdrTransition('history_taking', 'assessment', {
      preparationComplete: true,
      hasTargets: false,
    });
    expect(r.allowed).toBe(true);
    expect(r.isForwardSkip).toBe(true);
  });

  it('rejects assessment → desensitization without targets', () => {
    const r = checkEmdrTransition('assessment', 'desensitization', {
      preparationComplete: true,
      hasTargets: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/target/i);
  });

  it('allows assessment → desensitization with targets + prep', () => {
    const r = checkEmdrTransition('assessment', 'desensitization', PREP_DONE);
    expect(r.allowed).toBe(true);
    expect(r.isCanonicalForward).toBe(true);
  });
});

describe('checkEmdrTransition — non-gated transitions', () => {
  it('allows preparation → history_taking (regression always OK)', () => {
    const r = checkEmdrTransition('preparation', 'history_taking', PREP_NOT_DONE);
    expect(r.allowed).toBe(true);
    expect(r.isRegression).toBe(true);
  });

  it('allows transitioning into closure from anywhere', () => {
    // closure is reachable to end the session even mid-reprocessing
    const r = checkEmdrTransition('desensitization', 'closure', PREP_DONE);
    expect(r.allowed).toBe(true);
  });

  it('rejects same-phase no-op', () => {
    const r = checkEmdrTransition('preparation', 'preparation', PREP_DONE);
    expect(r.allowed).toBe(false);
  });

  it('rejects unknown phases', () => {
    expect(checkEmdrTransition('bogus', 'preparation', PREP_DONE).allowed).toBe(false);
    expect(checkEmdrTransition('preparation', 'bogus', PREP_DONE).allowed).toBe(false);
  });
});
