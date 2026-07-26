import { describe, expect, it } from 'vitest';
import { drugNameKey, sameDrug } from './drug-key';

describe('drugNameKey', () => {
  it('strips dosing, frequency and duration', () => {
    expect(drugNameKey('Amoxicillin 500mg TDS x 5 days')).toBe('amoxicillin');
    expect(drugNameKey('Metformin 500 BD')).toBe('metformin');
    expect(drugNameKey('Pantoprazole 40mg OD')).toBe('pantoprazole');
  });

  it('keeps multi-word generics distinct — the bug this exists for', () => {
    expect(drugNameKey('Insulin glargine 10U HS')).toBe('insulin glargine');
    expect(drugNameKey('Insulin aspart 6U TDS')).toBe('insulin aspart');
    expect(sameDrug('Insulin glargine 10U', 'Insulin aspart 6U')).toBe(false);
  });

  it('treats a dose change as the SAME drug', () => {
    expect(sameDrug('Metformin 500 BD', 'Metformin 1g BD')).toBe(true);
  });

  it('is case- and whitespace-insensitive, and strips the dev mock tag', () => {
    expect(drugNameKey('  [mock] ATORVASTATIN  20mg ')).toBe('atorvastatin');
  });

  it('handles a bare drug name with no dosing', () => {
    expect(drugNameKey('Paracetamol')).toBe('paracetamol');
  });

  it('never returns an empty key for non-empty input', () => {
    expect(drugNameKey('500mg')).toBe('500mg');
    expect(drugNameKey('')).toBe('');
  });
});
