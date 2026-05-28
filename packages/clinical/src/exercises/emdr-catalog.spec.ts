import { describe, it, expect } from 'vitest';
import { EMDR_EXERCISE_CATALOG, getEmdrExerciseById, getExerciseById } from './emdr-catalog';

describe('EMDR_EXERCISE_CATALOG', () => {
  it('has exactly 20 entries', () => {
    expect(EMDR_EXERCISE_CATALOG.length).toBe(20);
  });

  it('every id starts with emdr_ and is unique', () => {
    const ids = EMDR_EXERCISE_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^emdr_/);
  });

  it('includes the Phase 2 cornerstones (safe-place + grounding)', () => {
    const ids = new Set(EMDR_EXERCISE_CATALOG.map((e) => e.id));
    expect(ids.has('emdr_safe_place_installation')).toBe(true);
    expect(ids.has('emdr_grounding_5_4_3_2_1')).toBe(true);
    expect(ids.has('emdr_container_exercise')).toBe(true);
  });

  it('includes PTSD outcome measures (PCL-5 + IES-R) for pre/post', () => {
    const ids = new Set(EMDR_EXERCISE_CATALOG.map((e) => e.id));
    expect(ids.has('emdr_intake_pcl5')).toBe(true);
    expect(ids.has('emdr_intake_ies_r')).toBe(true);
  });

  it('getEmdrExerciseById finds by id; throws on miss', () => {
    expect(getEmdrExerciseById('emdr_safe_place_installation').title).toMatch(/safe/i);
    expect(() => getEmdrExerciseById('nope')).toThrow(/Unknown EMDR/);
  });

  it('getExerciseById resolves from BOTH catalogs', () => {
    expect(getExerciseById('emdr_safe_place_installation').title).toMatch(/safe/i);
    expect(getExerciseById('cbt_thought_record_5col').title).toMatch(/thought record/i);
    expect(() => getExerciseById('mystery_box')).toThrow(/Unknown exercise/);
  });
});
