import { describe, it, expect } from 'vitest';
import {
  EMDR_PHASES,
  EMDR_INITIAL_PHASE,
  EMDR_PHASE_DESCRIPTIONS,
  isEmdrPhase,
  nextEmdrPhase,
} from './phases';
import {
  checkEmdrPhasePrerequisites,
  checkEmdrTransition,
  checkEmdrWorkflowStart,
} from './state-machine';

const PREP_DONE = { preparationComplete: true, hasTargets: true };
const PREP_NOT_DONE = { preparationComplete: false, hasTargets: false };

describe('EMDR workflow entry and recorded prerequisite review', () => {
  it.each(EMDR_PHASES)('only allows the canonical phase when creating at %s', (phase) => {
    expect(checkEmdrWorkflowStart(phase).allowed).toBe(phase === EMDR_INITIAL_PHASE);
  });

  it('rejects an unknown starting phase', () => {
    expect(checkEmdrWorkflowStart('unknown').allowed).toBe(false);
  });

  it('shares existing prerequisite rules across all transitions and review', () => {
    for (const preparationComplete of [false, true]) {
      for (const hasTargets of [false, true]) {
        const context = { preparationComplete, hasTargets };
        for (const phase of EMDR_PHASES) {
          const needsPreparation = [
            'assessment',
            'desensitization',
            'installation',
            'body_scan',
          ].includes(phase);
          const needsTargets = ['desensitization', 'installation', 'body_scan'].includes(phase);
          const expected =
            (!needsPreparation || preparationComplete) && (!needsTargets || hasTargets);
          expect(checkEmdrPhasePrerequisites(phase, context).allowed).toBe(expected);
          for (const from of EMDR_PHASES) {
            if (from !== phase)
              expect(checkEmdrTransition(from, phase, context).allowed).toBe(expected);
          }
        }
      }
    }
  });

  it('only flags historical missing information without filling prerequisites', () => {
    const historical = Object.freeze({ preparationComplete: false, hasTargets: false });
    expect(checkEmdrPhasePrerequisites('desensitization', historical)).toMatchObject({
      allowed: false,
      reason: expect.stringContaining('not recorded'),
    });
    expect(historical).toEqual(PREP_NOT_DONE);
    expect(checkEmdrPhasePrerequisites('closure', historical).allowed).toBe(true);
  });
});

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
