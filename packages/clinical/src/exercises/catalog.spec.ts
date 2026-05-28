import { describe, it, expect } from 'vitest';
import { CBT_EXERCISE_CATALOG, getCbtExerciseById, listCbtExercisesByPhase } from './catalog';
import { CBT_PHASES } from '../modalities/cbt/phases';

describe('CBT_EXERCISE_CATALOG', () => {
  it('has exactly 20 entries', () => {
    expect(CBT_EXERCISE_CATALOG.length).toBe(20);
  });

  it('has unique ids', () => {
    const ids = CBT_EXERCISE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has at least one phaseTag from CBT_PHASES', () => {
    for (const e of CBT_EXERCISE_CATALOG) {
      expect(e.phaseTags.length).toBeGreaterThan(0);
      for (const phase of e.phaseTags) {
        expect((CBT_PHASES as readonly string[]).includes(phase)).toBe(true);
      }
    }
  });

  it('every phase has at least 3 exercises', () => {
    for (const phase of CBT_PHASES) {
      const matches = listCbtExercisesByPhase(phase);
      expect(matches.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('every entry has a positive estimatedDurationMin', () => {
    for (const e of CBT_EXERCISE_CATALOG) {
      expect(e.estimatedDurationMin).toBeGreaterThan(0);
    }
  });

  it('includes the three V1 outcome measures (PHQ-9, GAD-7, WHODAS-2)', () => {
    const ids = new Set(CBT_EXERCISE_CATALOG.map((e) => e.id));
    expect(ids.has('cbt_intake_phq9')).toBe(true);
    expect(ids.has('cbt_intake_gad7')).toBe(true);
    expect(ids.has('cbt_intake_whodas2')).toBe(true);
  });

  it('exposure ladder is gated to low_or_lower risk', () => {
    const exposure = getCbtExerciseById('cbt_exposure_ladder');
    expect(exposure.riskGate).toBe('low_or_lower');
  });
});

describe('getCbtExerciseById', () => {
  it('returns the matching entry', () => {
    const e = getCbtExerciseById('cbt_thought_record_5col');
    expect(e.title).toMatch(/5-column thought record/i);
  });

  it('throws on unknown id', () => {
    expect(() => getCbtExerciseById('not_a_real_id')).toThrow(/Unknown CBT exercise/);
  });
});

describe('listCbtExercisesByPhase', () => {
  it('returns only entries tagged for the phase', () => {
    const cogr = listCbtExercisesByPhase('cognitive_restructuring');
    expect(cogr.length).toBeGreaterThan(0);
    for (const e of cogr) {
      expect(e.phaseTags).toContain('cognitive_restructuring');
    }
  });
});
