import { describe, expect, it } from 'vitest';
import { IndianPhoneSchema } from '@cureocity/contracts';
import {
  fromNationalDigits,
  isValidIndianPhone,
  normaliseIndianPhone,
  toNationalDigits,
} from './phone';

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

describe('national-digit helpers (the +91 prefix field)', () => {
  it('extracts the national part from anything pasted in', () => {
    for (const raw of [
      '9876543210',
      '98765 43210',
      '+91 98765 43210',
      '+919876543210',
      '919876543210',
      '09876543210',
    ]) {
      expect(toNationalDigits(raw), raw).toBe('9876543210');
    }
  });

  it('caps at 10 digits so the field cannot hold something unsendable', () => {
    expect(toNationalDigits('98765432109999')).toHaveLength(10);
  });

  it('round-trips to a value the API accepts', () => {
    const canonical = fromNationalDigits(toNationalDigits('+91 98765 43210'));
    expect(canonical).toBe('+919876543210');
    expect(IndianPhoneSchema.safeParse(canonical).success).toBe(true);
  });

  it('treats an empty field as empty, not as a bare +91', () => {
    expect(fromNationalDigits('')).toBe('');
    expect(toNationalDigits('')).toBe('');
  });
});

describe('typing round-trip (regression)', () => {
  it('does not re-read the +91 prefix as national digits', () => {
    // Typing "9" produces the canonical "+919"; rendering that back must show
    // "9", not "919". A digit-count heuristic gets this wrong and the field
    // visibly rewrites what you just typed.
    expect(toNationalDigits('+919')).toBe('9');
    expect(toNationalDigits('+9198')).toBe('98');
    expect(toNationalDigits('+91987')).toBe('987');
  });

  it('stays stable digit by digit, exactly as the field drives it', () => {
    let canonical = '';
    for (const key of '9876543210') {
      canonical = fromNationalDigits(toNationalDigits(canonical) + key);
    }
    expect(canonical).toBe('+919876543210');
    expect(toNationalDigits(canonical)).toBe('9876543210');
    expect(isValidIndianPhone(canonical)).toBe(true);
  });
});
