import { describe, expect, it } from 'vitest';
import { checkInteractions, formatInteraction } from './interactions';

describe('checkInteractions', () => {
  it('flags warfarin + ibuprofen as a major bleeding interaction', () => {
    const res = checkInteractions(['Warfarin 5mg', 'Ibuprofen 400mg']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('major');
    expect([res[0]!.drugA, res[0]!.drugB].sort()).toEqual(['Ibuprofen', 'Warfarin']);
  });

  it('flags nitrate + sildenafil as contraindicated', () => {
    const res = checkInteractions(['Isosorbide mononitrate', 'Sildenafil 50mg']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('contraindicated');
  });

  it('recognises common Indian brand names (Ecosprin = aspirin)', () => {
    const res = checkInteractions(['Ecosprin 75', 'Warfarin']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('major');
    expect(res[0]!.drugA === 'Aspirin' || res[0]!.drugB === 'Aspirin').toBe(true);
  });

  it('flags ACE inhibitor + spironolactone (hyperkalaemia)', () => {
    const res = checkInteractions(['Enalapril 5mg', 'Spironolactone 25mg']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('major');
    expect(res[0]!.mechanism.toLowerCase()).toContain('potassium');
  });

  it('flags statin + clarithromycin (myopathy)', () => {
    const res = checkInteractions(['Atorvastatin 40mg', 'Clarithromycin 500mg']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('major');
  });

  it('flags two serotonergic drugs (serotonin syndrome)', () => {
    const res = checkInteractions(['Sertraline 50mg', 'Tramadol 50mg']);
    expect(res).toHaveLength(1);
    expect(res[0]!.severity).toBe('major');
  });

  it('returns nothing for a safe pair', () => {
    expect(checkInteractions(['Paracetamol 500mg', 'Amoxicillin 500mg'])).toEqual([]);
  });

  it('ignores unrecognised drugs rather than guessing', () => {
    expect(checkInteractions(['SomeNovelDrug', 'AnotherUnknown'])).toEqual([]);
  });

  it('does not double-count the same pair', () => {
    const res = checkInteractions(['Warfarin', 'Aspirin', 'Warfarin']);
    // Warfarin+Aspirin once (deduped), not Warfarin+Warfarin.
    expect(res).toHaveLength(1);
  });

  it('sorts most-severe first across multiple interactions', () => {
    const res = checkInteractions([
      'Atorvastatin',
      'Clarithromycin', // major
      'Isosorbide',
      'Sildenafil', // contraindicated
    ]);
    expect(res.length).toBeGreaterThanOrEqual(2);
    expect(res[0]!.severity).toBe('contraindicated');
  });

  it('formats a warning line with severity + both drugs + source', () => {
    const [i] = checkInteractions(['Warfarin', 'Aspirin']);
    const line = formatInteraction(i!);
    expect(line).toContain('MAJOR');
    expect(line).toContain('Warfarin');
    expect(line).toContain('Aspirin');
    expect(line).toMatch(/\[.+\]$/);
  });
});
