/**
 * Sprint 17 — Curated clinical instruments.
 *
 * PHQ-9 and GAD-7 are validated, copyrighted-but-permitted-for-clinical-use
 * screeners. Their VALIDITY depends on:
 *   * Exact item wording (paraphrasing breaks the instrument).
 *   * Exact response scale (0/1/2/3 → not at all / several days /
 *     more than half the days / nearly every day).
 *   * Exact summation + severity bands.
 *
 * We therefore curate these as TypeScript constants rather than
 * have the LLM generate them. Translations require clinician
 * sign-off — V1 ships English only with the schema in place so
 * future Malayalam / Hindi / Tamil versions slot in without
 * code changes once vetted.
 *
 * Sources:
 *   PHQ-9: Kroenke K, Spitzer RL, Williams JBW. JGIM 2001;16:606-613.
 *   GAD-7: Spitzer RL, Kroenke K, Williams JBW, Löwe B. AIM 2006;166:1092-1097.
 */

export type InstrumentKey = 'PHQ9' | 'GAD7';

export interface InstrumentItem {
  /** Stable id matching the row stored in InstrumentResponse.responses. */
  id: string;
  /** 1-based clinical numbering (PHQ-9 #1..9). */
  number: number;
  /**
   * Item text by language. Only `en` is populated in V1. Add
   * Malayalam / Hindi / Tamil / Bengali ONLY with validated
   * translations vetted by a clinician.
   */
  text: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
}

export interface InstrumentScaleOption {
  value: number;
  label: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
}

export interface InstrumentSeverityBand {
  /** Low end of the inclusive score range. */
  min: number;
  /** High end of the inclusive score range. */
  max: number;
  /** Snake-case key persisted on InstrumentResponse.severity. */
  key: string;
  /** Display label per language. */
  label: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
}

export interface InstrumentDefinition {
  key: InstrumentKey;
  title: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
  description: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
  /** Frame all items refer to. PHQ-9 + GAD-7 both use "over the last 2 weeks". */
  recallWindow: { en: string; ml?: string; hi?: string; ta?: string; bn?: string };
  items: InstrumentItem[];
  scale: InstrumentScaleOption[];
  severityBands: InstrumentSeverityBand[];
  /** Item index (1-based) of the suicidality-risk item, if any. */
  riskItemNumber?: number;
}

// ============================================================================
// PHQ-9 — Patient Health Questionnaire-9
// ============================================================================

const PHQ9_SCALE: InstrumentScaleOption[] = [
  { value: 0, label: { en: 'Not at all' } },
  { value: 1, label: { en: 'Several days' } },
  { value: 2, label: { en: 'More than half the days' } },
  { value: 3, label: { en: 'Nearly every day' } },
];

const PHQ9_ITEMS: InstrumentItem[] = [
  { id: 'phq9_1', number: 1, text: { en: 'Little interest or pleasure in doing things' } },
  { id: 'phq9_2', number: 2, text: { en: 'Feeling down, depressed, or hopeless' } },
  {
    id: 'phq9_3',
    number: 3,
    text: { en: 'Trouble falling or staying asleep, or sleeping too much' },
  },
  { id: 'phq9_4', number: 4, text: { en: 'Feeling tired or having little energy' } },
  { id: 'phq9_5', number: 5, text: { en: 'Poor appetite or overeating' } },
  {
    id: 'phq9_6',
    number: 6,
    text: {
      en: 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
    },
  },
  {
    id: 'phq9_7',
    number: 7,
    text: {
      en: 'Trouble concentrating on things, such as reading the newspaper or watching television',
    },
  },
  {
    id: 'phq9_8',
    number: 8,
    text: {
      en: 'Moving or speaking so slowly that other people could have noticed — or the opposite, being so fidgety or restless that you have been moving around a lot more than usual',
    },
  },
  {
    id: 'phq9_9',
    number: 9,
    text: { en: 'Thoughts that you would be better off dead, or of hurting yourself in some way' },
  },
];

export const PHQ9: InstrumentDefinition = {
  key: 'PHQ9',
  title: { en: 'PHQ-9 · Depression screen' },
  description: {
    en: '9-item depression severity questionnaire. Used to screen for and monitor major depression.',
  },
  recallWindow: {
    en: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?',
  },
  items: PHQ9_ITEMS,
  scale: PHQ9_SCALE,
  severityBands: [
    { min: 0, max: 4, key: 'minimal', label: { en: 'Minimal depression' } },
    { min: 5, max: 9, key: 'mild', label: { en: 'Mild depression' } },
    { min: 10, max: 14, key: 'moderate', label: { en: 'Moderate depression' } },
    { min: 15, max: 19, key: 'moderately_severe', label: { en: 'Moderately severe depression' } },
    { min: 20, max: 27, key: 'severe', label: { en: 'Severe depression' } },
  ],
  riskItemNumber: 9,
};

// ============================================================================
// GAD-7 — Generalized Anxiety Disorder-7
// ============================================================================

const GAD7_SCALE: InstrumentScaleOption[] = [
  { value: 0, label: { en: 'Not at all' } },
  { value: 1, label: { en: 'Several days' } },
  { value: 2, label: { en: 'More than half the days' } },
  { value: 3, label: { en: 'Nearly every day' } },
];

const GAD7_ITEMS: InstrumentItem[] = [
  { id: 'gad7_1', number: 1, text: { en: 'Feeling nervous, anxious, or on edge' } },
  { id: 'gad7_2', number: 2, text: { en: 'Not being able to stop or control worrying' } },
  { id: 'gad7_3', number: 3, text: { en: 'Worrying too much about different things' } },
  { id: 'gad7_4', number: 4, text: { en: 'Trouble relaxing' } },
  { id: 'gad7_5', number: 5, text: { en: 'Being so restless that it is hard to sit still' } },
  { id: 'gad7_6', number: 6, text: { en: 'Becoming easily annoyed or irritable' } },
  {
    id: 'gad7_7',
    number: 7,
    text: { en: 'Feeling afraid as if something awful might happen' },
  },
];

export const GAD7: InstrumentDefinition = {
  key: 'GAD7',
  title: { en: 'GAD-7 · Anxiety screen' },
  description: {
    en: '7-item generalized anxiety disorder severity questionnaire. Used to screen for and monitor anxiety.',
  },
  recallWindow: {
    en: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
  },
  items: GAD7_ITEMS,
  scale: GAD7_SCALE,
  severityBands: [
    { min: 0, max: 4, key: 'minimal', label: { en: 'Minimal anxiety' } },
    { min: 5, max: 9, key: 'mild', label: { en: 'Mild anxiety' } },
    { min: 10, max: 14, key: 'moderate', label: { en: 'Moderate anxiety' } },
    { min: 15, max: 21, key: 'severe', label: { en: 'Severe anxiety' } },
  ],
};

// ============================================================================
// Registry + lookup helpers
// ============================================================================

export const INSTRUMENTS: Record<InstrumentKey, InstrumentDefinition> = {
  PHQ9,
  GAD7,
};

export interface ScoreResult {
  score: number;
  severityKey: string;
  severityLabel: string;
  /** True when the suicidality item (PHQ-9 #9) was answered above 0. */
  riskFlagged: boolean;
}

export class InstrumentScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstrumentScoringError';
  }
}

/**
 * Score a response map against a definition. Throws if any item is
 * missing or out-of-range — the route layer translates that into a
 * 422 with the offending field.
 */
export function scoreInstrument(
  definition: InstrumentDefinition,
  responses: Record<string, number>,
  language: 'en' | 'ml' | 'hi' | 'ta' | 'bn' = 'en',
): ScoreResult {
  const allowedValues = new Set(definition.scale.map((s) => s.value));
  let total = 0;
  for (const item of definition.items) {
    const raw = responses[item.id];
    if (raw === undefined || raw === null) {
      throw new InstrumentScoringError(`Missing response for ${item.id}`);
    }
    if (!Number.isInteger(raw) || !allowedValues.has(raw)) {
      throw new InstrumentScoringError(
        `Invalid value for ${item.id}: ${raw} (expected ${[...allowedValues].join(' | ')})`,
      );
    }
    total += raw;
  }
  const band = definition.severityBands.find((b) => total >= b.min && total <= b.max);
  if (!band) {
    throw new InstrumentScoringError(
      `Score ${total} falls outside known severity bands for ${definition.key}`,
    );
  }
  const riskFlagged =
    definition.riskItemNumber !== undefined
      ? (responses[definition.items[definition.riskItemNumber - 1]!.id] ?? 0) > 0
      : false;
  return {
    score: total,
    severityKey: band.key,
    severityLabel: band.label[language] ?? band.label.en,
    riskFlagged,
  };
}
