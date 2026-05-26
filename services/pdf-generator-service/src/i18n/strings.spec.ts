import { describe, it, expect } from 'vitest';
import { isSupportedLocale, SUPPORTED_LOCALES, t } from './strings';

describe('i18n strings', () => {
  it('SUPPORTED_LOCALES is en + hi + ml', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'hi', 'ml']);
  });

  it('isSupportedLocale narrows', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('hi')).toBe(true);
    expect(isSupportedLocale('ml')).toBe(true);
    expect(isSupportedLocale('ta')).toBe(false);
    expect(isSupportedLocale('bn')).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });

  it('t() returns English for canonical keys', () => {
    expect(t('en', 'note.title')).toBe('Therapy Session Note');
    expect(t('en', 'plan.title')).toBe('Treatment Plan');
  });

  it('t() falls back to English when HI / ML string is missing', () => {
    // Both currently inherit unspecified keys from EN via spread
    expect(t('hi', 'note.disclaimerHeader')).toBe('Disclaimer');
    expect(t('ml', 'note.signedAt')).toBe('Signed at');
  });
});
