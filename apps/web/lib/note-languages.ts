/**
 * The languages a therapist can render a note / report into.
 *
 * This is a PRESENTATION concern — the note is translated so it can be read
 * by (and shared with) the client in their language — and is deliberately
 * broader than the curated, human-validated clinical-output set in
 * `ClinicalLocaleSchema` (contracts). Anything the translation model handles
 * well is fair game, so it lives here as a plain list rather than a contracts
 * enum. India-first: every Google-translatable Indian language, then Middle
 * East, then the major world languages.
 */

export type NoteLanguageGroup = 'Indian' | 'Middle East' | 'World';

export interface NoteLanguage {
  /** ISO 639 code, stored as the note's language tag. */
  code: string;
  /** English name. */
  label: string;
  /** Endonym (own-script name), shown alongside the English label. */
  native?: string;
  group: NoteLanguageGroup;
}

export const NOTE_LANGUAGES: NoteLanguage[] = [
  { code: 'en', label: 'English', group: 'World' },

  // ---- India --------------------------------------------------------------
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', group: 'Indian' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', group: 'Indian' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', group: 'Indian' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', group: 'Indian' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', group: 'Indian' },
  { code: 'ur', label: 'Urdu', native: 'اردو', group: 'Indian' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', group: 'Indian' },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', group: 'Indian' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', group: 'Indian' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ', group: 'Indian' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', group: 'Indian' },
  { code: 'as', label: 'Assamese', native: 'অসমীয়া', group: 'Indian' },
  { code: 'mai', label: 'Maithili', native: 'मैथिली', group: 'Indian' },
  { code: 'kok', label: 'Konkani', native: 'कोंकणी', group: 'Indian' },
  { code: 'sd', label: 'Sindhi', native: 'سنڌي', group: 'Indian' },
  { code: 'doi', label: 'Dogri', native: 'डोगरी', group: 'Indian' },
  { code: 'mni', label: 'Manipuri (Meitei)', native: 'ꯃꯩꯇꯩꯂꯣꯟ', group: 'Indian' },
  { code: 'bho', label: 'Bhojpuri', native: 'भोजपुरी', group: 'Indian' },
  { code: 'ne', label: 'Nepali', native: 'नेपाली', group: 'Indian' },
  { code: 'sa', label: 'Sanskrit', native: 'संस्कृतम्', group: 'Indian' },

  // ---- Middle East --------------------------------------------------------
  { code: 'ar', label: 'Arabic', native: 'العربية', group: 'Middle East' },
  { code: 'fa', label: 'Persian', native: 'فارسی', group: 'Middle East' },
  { code: 'he', label: 'Hebrew', native: 'עברית', group: 'Middle East' },

  // ---- World --------------------------------------------------------------
  { code: 'es', label: 'Spanish', native: 'Español', group: 'World' },
  { code: 'fr', label: 'French', native: 'Français', group: 'World' },
  { code: 'de', label: 'German', native: 'Deutsch', group: 'World' },
  { code: 'pt', label: 'Portuguese', native: 'Português', group: 'World' },
  { code: 'ru', label: 'Russian', native: 'Русский', group: 'World' },
  { code: 'zh', label: 'Chinese (Simplified)', native: '中文', group: 'World' },
  { code: 'ja', label: 'Japanese', native: '日本語', group: 'World' },
  { code: 'ko', label: 'Korean', native: '한국어', group: 'World' },
  { code: 'it', label: 'Italian', native: 'Italiano', group: 'World' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', group: 'World' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe', group: 'World' },
  { code: 'th', label: 'Thai', native: 'ไทย', group: 'World' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', group: 'World' },
  { code: 'sw', label: 'Swahili', native: 'Kiswahili', group: 'World' },
];

const BY_CODE = new Map(NOTE_LANGUAGES.map((l) => [l.code, l]));

export function noteLanguage(code: string): NoteLanguage | undefined {
  return BY_CODE.get(code);
}

/** English name for a code, falling back to the upper-cased code. */
export function noteLanguageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code.toUpperCase();
}

/**
 * Languages grouped for the picker, in India-first order. English is handled
 * separately (rendered as the leading default option), so it's excluded here.
 */
export function noteLanguagesByGroup(): { group: NoteLanguageGroup; languages: NoteLanguage[] }[] {
  const order: NoteLanguageGroup[] = ['Indian', 'Middle East', 'World'];
  return order
    .map((group) => ({
      group,
      languages: NOTE_LANGUAGES.filter((l) => l.group === group && l.code !== 'en'),
    }))
    .filter((g) => g.languages.length > 0);
}
