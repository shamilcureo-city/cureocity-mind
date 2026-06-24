import { useEffect, useState } from 'react';
import type { GlossaryEntry } from './clinical-glossary';

/**
 * Sprint 69 — locale layer for the education content.
 *
 * The infrastructure for multilingual education: a per-device language
 * preference and a resolver that overlays a locale's copy on the English
 * base, field by field, falling back to English for anything missing.
 *
 * Ships English-only on purpose. Clinical copy is NEVER machine-translated
 * (a wrong word in a mental-health context is a real harm); `hi` / `ml`
 * become selectable only once a clinician has validated their copy and the
 * locale is added to VALIDATED_LOCALES.
 */

export type Locale = 'en' | 'hi' | 'ml';

export const LOCALES: Locale[] = ['en', 'hi', 'ml'];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ml: 'മലയാളം',
};

/** Locales whose education copy has been human-validated. English only today. */
export const VALIDATED_LOCALES: Locale[] = ['en'];

const KEY = 'cm.locale';
const EVENT = 'cm:locale-change';

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'hi' || v === 'ml';
}

export function getStoredLocale(): Locale {
  try {
    const v = window.localStorage.getItem(KEY);
    if (isLocale(v) && VALIDATED_LOCALES.includes(v)) return v;
  } catch {
    // ignore
  }
  return 'en';
}

export function setLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(KEY, locale);
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // ignore
  }
}

/** Reactive current locale — updates live when the toggle changes it. */
export function useLocale(): Locale {
  const [locale, setLoc] = useState<Locale>('en');
  useEffect(() => {
    setLoc(getStoredLocale());
    const handler = (): void => setLoc(getStoredLocale());
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return locale;
}

/** Overlay a locale's translation onto the English base, field by field. */
export function resolveGlossaryEntry(entry: GlossaryEntry, locale: Locale): GlossaryEntry {
  if (locale === 'en' || !entry.translations) return entry;
  const t = entry.translations[locale];
  if (!t) return entry;
  return {
    ...entry,
    plainTitle: t.plainTitle ?? entry.plainTitle,
    term: t.term ?? entry.term,
    what: t.what ?? entry.what,
    why: t.why ?? entry.why,
    example: t.example ?? entry.example,
  };
}
