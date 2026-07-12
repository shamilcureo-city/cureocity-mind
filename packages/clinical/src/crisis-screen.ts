/**
 * Cureocity Care — deterministic live crisis screen (docs/AI_COUNSELING.md
 * §2 layer 4a). Every transcript turn mirrored to the server is screened
 * here BEFORE anything model-dependent gets a say. Zero LLM.
 *
 * Phrase lists are CLINICIAN-REVIEWED, per language, including
 * transliterated code-mix (Manglish / Hinglish). The same sign-off rule as
 * the reliable-change thresholds applies: NEVER loosen these without a
 * clinician's sign-off. Adding phrases is safe; removing them is not.
 *
 * Design notes:
 * - Substring match over lowercased text. Deliberately simple: reviewable
 *   by a clinician line-by-line, testable exhaustively, no tokenizer to
 *   drift. False positives end a session early and show hotlines — an
 *   acceptable failure mode; false negatives are not.
 * - Devanagari / Malayalam script phrases are matched as-is (no lowering
 *   needed); Latin transliterations cover the code-mix reality.
 */

export interface CrisisScreenMatch {
  phrase: string;
  language: string;
}

export interface CrisisScreenResult {
  hit: boolean;
  matches: CrisisScreenMatch[];
}

interface PhraseList {
  language: string;
  phrases: string[];
}

const PHRASE_LISTS: PhraseList[] = [
  {
    language: 'en',
    phrases: [
      'kill myself',
      'killing myself',
      'end my life',
      'ending my life',
      'end it all',
      'want to die',
      'wish i was dead',
      'wish i were dead',
      'better off dead',
      'better off without me',
      'suicide',
      'suicidal',
      'hurt myself',
      'hurting myself',
      'harm myself',
      'harming myself',
      'self harm',
      'self-harm',
      'cut myself',
      'cutting myself',
      'overdose',
      'no reason to live',
      'no point in living',
      "don't want to be alive",
      'do not want to be alive',
      "don't want to live",
      'do not want to live',
      'take my own life',
      'kill him',
      'kill her',
      'kill them',
      'hurt someone',
    ],
  },
  {
    language: 'hi',
    phrases: [
      // Devanagari
      'आत्महत्या',
      'खुदकुशी',
      'मरना चाहता',
      'मरना चाहती',
      'जान देना',
      'जान दे दूं',
      'खुद को नुकसान',
      'जीना नहीं चाहता',
      'जीना नहीं चाहती',
      // Hinglish transliterations
      'khudkushi',
      'aatmahatya',
      'marna chahta',
      'marna chahti',
      'jaan dena',
      'jaan de dun',
      'jeena nahi chahta',
      'jeena nahi chahti',
      'khud ko nuksan',
    ],
  },
  {
    language: 'ml',
    phrases: [
      // Malayalam script
      'ആത്മഹത്യ',
      'മരിക്കണം',
      'ജീവിക്കണ്ട',
      'ജീവനൊടുക്ക',
      'സ്വയം മുറിവേൽപ്പിക്ക',
      // Manglish transliterations
      'aathmahathya',
      'atmahatya',
      'marikkanam',
      'jeevikkanda',
      'jeevanodukk',
      'swayam murivelppikk',
    ],
  },
];

/**
 * Screen a batch of turn texts. Returns every phrase hit with its
 * language — the matches land in the audit row's metadata so the
 * escalation is reviewable.
 */
export function screenForCrisis(texts: string[]): CrisisScreenResult {
  const matches: CrisisScreenMatch[] = [];
  for (const raw of texts) {
    if (!raw) continue;
    const lowered = raw.toLowerCase();
    for (const list of PHRASE_LISTS) {
      for (const phrase of list.phrases) {
        // Non-Latin phrases are case-invariant; Latin lists are stored
        // lowercase so the lowered text matches directly.
        if (lowered.includes(phrase) || raw.includes(phrase)) {
          matches.push({ phrase, language: list.language });
        }
      }
    }
  }
  return { hit: matches.length > 0, matches };
}
