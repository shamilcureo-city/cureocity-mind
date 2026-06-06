import { describe, it, expect } from 'vitest';
import { CreateClientInputSchema, UpdateClientInputSchema } from './client';

describe('CreateClientInputSchema', () => {
  const valid = {
    fullName: 'Arjun Rao',
    contactPhone: '+919812345678',
    contactEmail: 'arjun@example.in',
    dateOfBirth: '1992-03-14',
    presentingConcerns: 'Anxiety',
    preferredModality: 'CBT' as const,
    consents: [
      {
        scope: 'AUDIO_RECORDING' as const,
        scriptVersion: 'v1.0',
        capturedVia: 'IN_PERSON' as const,
      },
    ],
  };

  it('accepts a well-formed input', () => {
    expect(CreateClientInputSchema.parse(valid)).toMatchObject({ fullName: 'Arjun Rao' });
  });

  it('rejects when consents are empty', () => {
    expect(() => CreateClientInputSchema.parse({ ...valid, consents: [] })).toThrow(
      /at least one/i,
    );
  });

  it('rejects non-Indian phone numbers', () => {
    expect(() => CreateClientInputSchema.parse({ ...valid, contactPhone: '+14155552671' })).toThrow(
      /\+91/,
    );
  });

  it('rejects malformed script versions', () => {
    expect(() =>
      CreateClientInputSchema.parse({
        ...valid,
        consents: [{ ...valid.consents[0]!, scriptVersion: '1.0' }],
      }),
    ).toThrow();
  });

  it('makes contactEmail optional', () => {
    const { contactEmail: _omitted, ...rest } = valid;
    void _omitted;
    expect(() => CreateClientInputSchema.parse(rest)).not.toThrow();
  });

  it('accepts preferredLanguage = "ml" and "en"', () => {
    expect(
      CreateClientInputSchema.safeParse({ ...valid, preferredLanguage: 'ml' }).success,
    ).toBe(true);
    expect(
      CreateClientInputSchema.safeParse({ ...valid, preferredLanguage: 'en' }).success,
    ).toBe(true);
  });

  it('rejects a malformed preferredLanguage', () => {
    expect(
      CreateClientInputSchema.safeParse({ ...valid, preferredLanguage: 'klingon' }).success,
    ).toBe(false);
  });

  it('accepts spokenLanguages array (Manglish + Hindi mix)', () => {
    const parsed = CreateClientInputSchema.safeParse({
      ...valid,
      spokenLanguages: ['ml', 'en', 'hi'],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects > 5 spoken languages', () => {
    expect(
      CreateClientInputSchema.safeParse({
        ...valid,
        spokenLanguages: ['ml', 'en', 'hi', 'ta', 'bn', 'kn'],
      }).success,
    ).toBe(false);
  });

  it('rejects an entry that is not ISO 639-1', () => {
    expect(
      CreateClientInputSchema.safeParse({
        ...valid,
        spokenLanguages: ['ml', 'KLINGON'],
      }).success,
    ).toBe(false);
  });
});

describe('UpdateClientInputSchema', () => {
  it('accepts a single-field update', () => {
    expect(UpdateClientInputSchema.parse({ fullName: 'New Name' })).toEqual({
      fullName: 'New Name',
    });
  });

  it('rejects an empty object', () => {
    expect(() => UpdateClientInputSchema.parse({})).toThrow(/at least one field/i);
  });

  it('accepts null for nullable fields', () => {
    expect(UpdateClientInputSchema.parse({ contactEmail: null })).toEqual({ contactEmail: null });
  });
});
