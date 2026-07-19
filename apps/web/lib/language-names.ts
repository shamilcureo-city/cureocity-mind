/**
 * UI truth pass (2026-07 audit) — human names for ISO 639-1 codes.
 *
 * The app was rendering raw codes in chips ("spoken: en", "language: en").
 * A clinical product for multilingual Indian practice should say "English",
 * "Malayalam", "Hindi". Uses Intl.DisplayNames (Node 22 + all evergreen
 * browsers) with a small fallback map for the codes we actually see, so a
 * missing Intl implementation can never render "undefined".
 */

const FALLBACK: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ml: 'Malayalam',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ur: 'Urdu',
};

export function languageName(code: string): string {
  const key = code.trim().toLowerCase();
  if (!key) return code;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(key);
    if (name && name !== key) return name;
  } catch {
    // Unknown/malformed code — fall through to the map, then the raw code.
  }
  return FALLBACK[key] ?? code;
}

/** "ml + en" → "Malayalam + English" (order preserved — it's the code-mix). */
export function languageNames(codes: readonly string[]): string {
  return codes.map(languageName).join(' + ');
}
