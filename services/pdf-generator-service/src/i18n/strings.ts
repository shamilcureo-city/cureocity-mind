/**
 * Locale strings for PDF templates.
 *
 * EN canonical; HI / ML are placeholders pending translator workflow
 * (Sprint 5 / 6 plan). Stable keys — never rename. Translator drops
 * strings into the hi / ml columns once available.
 *
 * TA / BN are v1.5 per plan § 5 Sprint 6.
 */

export type Locale = 'en' | 'hi' | 'ml';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'hi', 'ml'];

type StringKey =
  | 'note.title'
  | 'note.client'
  | 'note.session'
  | 'note.modality'
  | 'note.scheduled'
  | 'note.duration'
  | 'note.subjective'
  | 'note.objective'
  | 'note.assessment'
  | 'note.plan'
  | 'note.riskHeader'
  | 'note.riskSeverity'
  | 'note.riskIndicators'
  | 'note.phaseHints'
  | 'note.signedBy'
  | 'note.signedAt'
  | 'note.disclaimerHeader'
  | 'note.disclaimerBody'
  | 'plan.title'
  | 'plan.preparedFor'
  | 'plan.preparedBy'
  | 'plan.modality'
  | 'plan.goals'
  | 'plan.currentPhase'
  | 'plan.exercisesHeader'
  | 'plan.exerciseDue'
  | 'plan.crisisHeader'
  | 'plan.crisisBody'
  | 'plan.footer';

const EN: Record<StringKey, string> = {
  'note.title': 'Therapy Session Note',
  'note.client': 'Client',
  'note.session': 'Session',
  'note.modality': 'Modality',
  'note.scheduled': 'Scheduled at',
  'note.duration': 'Duration',
  'note.subjective': 'Subjective',
  'note.objective': 'Objective',
  'note.assessment': 'Assessment',
  'note.plan': 'Plan',
  'note.riskHeader': 'Risk Flags',
  'note.riskSeverity': 'Severity',
  'note.riskIndicators': 'Indicators',
  'note.phaseHints': 'Phase Progression Hints',
  'note.signedBy': 'Signed by',
  'note.signedAt': 'Signed at',
  'note.disclaimerHeader': 'Disclaimer',
  'note.disclaimerBody':
    'AI-assisted note. Clinician review and signature confirm clinical accuracy.',
  'plan.title': 'Treatment Plan',
  'plan.preparedFor': 'Prepared for',
  'plan.preparedBy': 'Prepared by',
  'plan.modality': 'Approach',
  'plan.goals': 'Our goals together',
  'plan.currentPhase': 'Where we are now',
  'plan.exercisesHeader': 'Between-session practice',
  'plan.exerciseDue': 'Due',
  'plan.crisisHeader': 'If you need help between sessions',
  'plan.crisisBody':
    'iCall: 9152987821 (24×7). Vandrevala Foundation: 1860-2662-345. If you feel unsafe right now, call 112 or go to your nearest hospital.',
  'plan.footer':
    'This plan is a living document — we will update it together as therapy progresses.',
};

const HI: Record<StringKey, string> = {
  // TODO(translator): Devanagari strings pending. English fallback for V1.
  ...EN,
  'note.title': 'थेरेपी सत्र नोट',
  'note.client': 'क्लाइंट',
  'note.session': 'सत्र',
  'note.modality': 'पद्धति',
  'plan.title': 'उपचार योजना',
  'plan.preparedFor': 'के लिए तैयार',
  'plan.preparedBy': 'द्वारा तैयार',
  'plan.modality': 'दृष्टिकोण',
  'plan.goals': 'हमारे साथ-साथ के लक्ष्य',
  'plan.currentPhase': 'अभी हम कहाँ हैं',
  'plan.exercisesHeader': 'सत्रों के बीच का अभ्यास',
  'plan.crisisHeader': 'अगर सत्रों के बीच आपको मदद चाहिए',
  'plan.crisisBody': 'iCall: 9152987821 (24×7). Vandrevala Foundation: 1860-2662-345. आपातकाल: 112',
};

const ML: Record<StringKey, string> = {
  // TODO(translator): Malayalam strings pending. English fallback for V1.
  ...EN,
  'note.title': 'തെറാപ്പി സെഷൻ കുറിപ്പ്',
  'note.client': 'ക്ലയന്റ്',
  'note.session': 'സെഷൻ',
  'plan.title': 'ചികിത്സാ പദ്ധതി',
  'plan.preparedFor': 'ഇതിനായി തയ്യാറാക്കിയത്',
  'plan.preparedBy': 'തയ്യാറാക്കിയത്',
  'plan.goals': 'നമ്മുടെ ലക്ഷ്യങ്ങൾ',
  'plan.currentPhase': 'നാം ഇപ്പോൾ എവിടെയാണ്',
  'plan.exercisesHeader': 'സെഷനുകൾക്കിടയിലെ പരിശീലനം',
};

const TABLE: Record<Locale, Record<StringKey, string>> = { en: EN, hi: HI, ml: ML };

export function t(locale: Locale, key: StringKey): string {
  return TABLE[locale][key] ?? TABLE.en[key];
}

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
