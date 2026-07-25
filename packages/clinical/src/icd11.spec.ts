import { describe, expect, it } from 'vitest';
import { ICD11_CATALOG, ICD11_ENTRIES, icd11Label, searchIcd11 } from './icd11';

describe('ICD-11 catalogue', () => {
  it('has no duplicate codes', () => {
    const codes = ICD11_ENTRIES.map((e) => e.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('uses well-formed ICD-11 codes throughout', () => {
    for (const { code } of ICD11_ENTRIES) {
      expect(code, `${code} is not a well-formed ICD-11 code`).toMatch(
        /^[0-9A-Z]{2,}(\.[0-9A-Z]+)*$/,
      );
    }
  });

  it('never ships an empty block', () => {
    for (const block of ICD11_CATALOG) expect(block.entries.length).toBeGreaterThan(0);
  });

  it('resolves a known code to its WHO title, and is case-insensitive', () => {
    expect(icd11Label('6B00')).toBe('Generalised anxiety disorder');
    expect(icd11Label('6b00')).toBe('Generalised anxiety disorder');
    expect(icd11Label(' 6B00 ')).toBe('Generalised anxiety disorder');
  });

  it('returns null outside the curated subset rather than guessing', () => {
    expect(icd11Label('ZZ99')).toBeNull();
  });

  it('ranks an exact code match first', () => {
    expect(searchIcd11('6B00')[0]?.code).toBe('6B00');
  });

  it('finds entries by code prefix', () => {
    const codes = searchIcd11('6B0').map((e) => e.code);
    expect(codes).toContain('6B00');
    expect(codes).toContain('6B04');
  });

  it('finds entries by label text', () => {
    expect(searchIcd11('panic')[0]?.label).toBe('Panic disorder');
  });

  it('narrows with each additional term rather than widening', () => {
    const broad = searchIcd11('depressive');
    const narrow = searchIcd11('depressive moderate');
    expect(narrow.length).toBeLessThan(broad.length);
    for (const entry of narrow) {
      expect(entry.label.toLowerCase()).toContain('moderate');
    }
  });

  it('returns nothing for a query that matches neither code nor label', () => {
    expect(searchIcd11('zzzznotathing')).toHaveLength(0);
  });

  it('respects the result limit', () => {
    expect(searchIcd11('', 5)).toHaveLength(5);
  });
});
