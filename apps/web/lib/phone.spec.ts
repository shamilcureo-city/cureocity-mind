import { describe, expect, it } from 'vitest';
import { IndianPhoneSchema } from '@cureocity/contracts';
import { isValidIndianPhone, normaliseIndianPhone } from './phone';

describe('normaliseIndianPhone', () => {
  it('accepts the shapes a therapist actually types', () => {
    // Every one of these failed "Validation failed" before, with no field name.
    for (const raw of [
      '+91 98765 43210',
      '+91-98765-43210',
      '+91 (98765) 43210',
      '9876543210',
      '98765 43210',
      '919876543210',
      '09876543210',
      '+919876543210',
    ]) {
      expect(normaliseIndianPhone(raw), raw).toBe('+919876543210');
      expect(isValidIndianPhone(raw), raw).toBe(true);
    }
  });

  it('produces a value the API schema accepts', () => {
    expect(IndianPhoneSchema.safeParse(normaliseIndianPhone('+91 98765 43210')).success).toBe(true);
    expect(IndianPhoneSchema.safeParse(normaliseIndianPhone('9876543210')).success).toBe(true);
  });

  it('leaves other countries alone rather than guessing', () => {
    expect(normaliseIndianPhone('+1 555 010 0100')).toBe('+15550100100');
    expect(isValidIndianPhone('+1 555 010 0100')).toBe(false);
  });

  it('does not silently reshape a wrong-length +91 number', () => {
    // 9 digits — a real typo. Surfacing it beats inventing a digit.
    expect(normaliseIndianPhone('+91 98765 4321')).toBe('+91987654321');
    expect(isValidIndianPhone('+91 98765 4321')).toBe(false);
  });

  it('rejects too many digits', () => {
    expect(isValidIndianPhone('+91 98765 432100')).toBe(false);
    expect(isValidIndianPhone('98765432100')).toBe(false);
  });

  it('handles an empty value without throwing', () => {
    expect(normaliseIndianPhone('')).toBe('');
    expect(normaliseIndianPhone('   ')).toBe('');
    expect(isValidIndianPhone('')).toBe(false);
  });
});
