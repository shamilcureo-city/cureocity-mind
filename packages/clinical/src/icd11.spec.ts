import { describe, expect, it } from 'vitest';
import { ICD11_CATALOG, ICD11_ENTRIES, icd11Block, icd11Label, searchIcd11 } from './icd11';

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

  it('prefers the plain category over a qualified one at the same tier', () => {
    // Both labels start with "panic"; the shorter is the actual disorder.
    expect(searchIcd11('panic')[0]?.code).toBe('6B01');
  });

  it('expands the substance-use children onto the right stems', () => {
    expect(icd11Label('6C40.2')).toBe('Alcohol dependence');
    expect(icd11Label('6C43.4')).toBe('Opioid withdrawal');
    expect(icd11Label('6C41.0')).toBe('Episode of harmful use of cannabis');
    expect(icd11Label('6C45.6')).toBe('Cocaine-induced psychotic disorder');
  });

  it('omits substance children that ICD-11 does not define', () => {
    // No caffeine dependence, and no nicotine intoxication.
    expect(icd11Label('6C48.2')).toBeNull();
    expect(icd11Label('6C4A.3')).toBeNull();
    // …but their neighbours on the same stem do exist.
    expect(icd11Label('6C48.4')).toBe('Caffeine withdrawal');
    expect(icd11Label('6C4A.2')).toBe('Nicotine dependence');
  });

  it('covers the blocks a psychology practice records in', () => {
    for (const code of [
      '6A05', // ADHD
      '6A20', // schizophrenia
      '6A40', // catatonia
      '6A60', // bipolar I
      '6A70.1', // moderate depression
      '6B00', // GAD
      '6B20', // OCD
      '6B40', // PTSD
      '6B64', // DID
      '6B80', // anorexia
      '6C20', // bodily distress
      '6C51', // gaming disorder
      '6C73', // intermittent explosive
      '6C91', // conduct-dissocial
      '6D10.1', // moderate personality disorder
      '6D11.5', // borderline pattern
      '6D30', // exhibitionistic disorder
      '6D70', // delirium
      '6D82', // Lewy body dementia
      '6E62', // secondary mood syndrome
      '7A00', // chronic insomnia
      'QE60', // employment problems
    ]) {
      expect(icd11Label(code), `${code} missing from the catalogue`).not.toBeNull();
    }
  });

  it('reports the block a code belongs to', () => {
    expect(icd11Block('6B00')).toBe('Anxiety or fear-related disorders');
    expect(icd11Block('6C40.2')).toBe('Substance use — alcohol');
    expect(icd11Block('ZZ99')).toBeNull();
  });

  it('is substantially larger than a stem-only list', () => {
    // Guards against a future edit quietly gutting the catalogue.
    expect(ICD11_ENTRIES.length).toBeGreaterThan(350);
  });
});
