import { describe, it, expect } from 'vitest';
import { CreatePsychologistInputSchema, RciNumberSchema } from './psychologist';

describe('CreatePsychologistInputSchema', () => {
  const valid = {
    fullName: 'Dr. Priya Menon',
    email: 'priya@example.in',
    phone: '+919876543210',
    rciNumber: 'A12345',
  };

  it('accepts a well-formed registration', () => {
    expect(CreatePsychologistInputSchema.parse(valid).rciNumber).toBe('A12345');
  });

  it('rejects malformed RCI numbers', () => {
    expect(() => CreatePsychologistInputSchema.parse({ ...valid, rciNumber: '12345' })).toThrow();
    expect(() => CreatePsychologistInputSchema.parse({ ...valid, rciNumber: 'a12345' })).toThrow();
  });

  it('rejects non-email values', () => {
    expect(() =>
      CreatePsychologistInputSchema.parse({ ...valid, email: 'not-an-email' }),
    ).toThrow();
  });

  it('rejects phone without +91 prefix', () => {
    expect(() => CreatePsychologistInputSchema.parse({ ...valid, phone: '9876543210' })).toThrow();
  });
});

describe('RciNumberSchema', () => {
  it('accepts canonical RCI numbers', () => {
    expect(() => RciNumberSchema.parse('A12345')).not.toThrow();
    expect(() => RciNumberSchema.parse('B7')).not.toThrow();
  });
});
