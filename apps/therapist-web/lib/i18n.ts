/**
 * Bilingual consent + UI strings.
 *
 * EN canonical; HI placeholder per Sprint 7 plan. Stable keys; translator
 * fills HI strings once available.
 */

export type UiLocale = 'en' | 'hi';
export const UI_LOCALES: readonly UiLocale[] = ['en', 'hi'];

type Key =
  | 'consent.title'
  | 'consent.body'
  | 'consent.crossBorder'
  | 'consent.crossBorderBody'
  | 'consent.audio'
  | 'consent.audioBody'
  | 'consent.aiNotes'
  | 'consent.aiNotesBody'
  | 'consent.scriptVersion'
  | 'consent.capture'
  | 'consent.captureBiometric'
  | 'consent.recorded'
  | 'session.start'
  | 'session.stop'
  | 'session.recording'
  | 'session.preparing'
  | 'session.finishing'
  | 'session.error'
  | 'session.chunksUploaded'
  | 'session.pendingUpload'
  | 'session.recoveryBanner'
  | 'review.title'
  | 'review.edit'
  | 'review.sign'
  | 'review.signed'
  | 'review.riskAck'
  | 'review.riskAckLabel';

const EN: Record<Key, string> = {
  'consent.title': 'Session recording consent',
  'consent.body':
    'Before this session begins, please confirm with the client what they agree to. You can toggle each scope individually.',
  'consent.crossBorder': 'Cross-border processing',
  'consent.crossBorderBody':
    'Note generation uses an AI model hosted outside India (de-identified transcript only). Audio never leaves India.',
  'consent.audio': 'Audio recording',
  'consent.audioBody':
    'We record session audio at 16 kHz mono for transcription. Audio is deleted after 30 days.',
  'consent.aiNotes': 'AI-assisted note generation',
  'consent.aiNotesBody':
    'An AI assistant drafts the therapy note. You review and sign before it becomes part of the record.',
  'consent.scriptVersion': 'Script version',
  'consent.capture': 'Record consent',
  'consent.captureBiometric': 'Confirm with biometric',
  'consent.recorded': 'Consent recorded',
  'session.start': 'Start recording',
  'session.stop': 'Stop and process',
  'session.recording': 'Recording',
  'session.preparing': 'Requesting microphone…',
  'session.finishing': 'Finalising…',
  'session.error': 'Error',
  'session.chunksUploaded': 'Chunks uploaded',
  'session.pendingUpload': 'pending upload',
  'session.recoveryBanner':
    'Resuming after a refresh. Audio chunks already saved have been preserved.',
  'review.title': 'Review and sign',
  'review.edit': 'Edit',
  'review.sign': 'Sign note',
  'review.signed': 'Signed',
  'review.riskAck': 'Risk acknowledgement',
  'review.riskAckLabel': 'I have reviewed the risk flags and addressed any clinical concerns.',
};

const HI: Record<Key, string> = {
  // TODO(translator): full Devanagari. English fallback for V1.
  ...EN,
  'consent.title': 'सत्र रिकॉर्डिंग सहमति',
  'consent.audio': 'ऑडियो रिकॉर्डिंग',
  'consent.aiNotes': 'AI-सहायित नोट जनरेशन',
  'consent.crossBorder': 'सीमा-पार प्रसंस्करण',
  'consent.capture': 'सहमति दर्ज करें',
  'session.start': 'रिकॉर्डिंग शुरू करें',
  'session.stop': 'रोकें और प्रसंस्करण करें',
  'session.recording': 'रिकॉर्डिंग जारी है',
  'review.title': 'समीक्षा करें और हस्ताक्षर करें',
  'review.sign': 'नोट पर हस्ताक्षर करें',
};

const TABLE: Record<UiLocale, Record<Key, string>> = { en: EN, hi: HI };

export function tUi(locale: UiLocale, key: Key): string {
  return TABLE[locale][key] ?? TABLE.en[key];
}
