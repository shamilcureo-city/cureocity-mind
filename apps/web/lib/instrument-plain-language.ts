/**
 * Plain-language layer for scored instruments (PHQ-9 / GAD-7).
 *
 * Our pilot therapists — and, through shared reports, their clients —
 * are often not clinically trained. These pure helpers turn severity
 * band keys and raw scores into short, calm, everyday sentences. They
 * NEVER invent new thresholds or scores; they only re-word the existing
 * band system ('minimal' | 'mild' | 'moderate' | 'moderately_severe' |
 * 'severe') from packages/clinical/src/instruments.
 *
 * Deliberately dependency-free (types only) so it can be imported from
 * any component without pulling in the clinical package.
 */

/**
 * Full-words label for a severity band key. Never abbreviates
 * (e.g. 'moderately severe', never 'mod-severe'). Unknown keys fall
 * back to a title-cased, de-underscored version so nothing renders as
 * a raw snake_case token.
 */
export function severityLabel(band: string): string {
  switch (band) {
    case 'minimal':
      return 'minimal';
    case 'mild':
      return 'mild';
    case 'moderate':
      return 'moderate';
    case 'moderately_severe':
      return 'moderately severe';
    case 'severe':
      return 'severe';
    default:
      return band
        .split(/[_\s]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
  }
}

/** Short everyday sentence for a PHQ-9 (depression) result. */
export function phq9Plain(score: number, band: string): string {
  switch (band) {
    case 'minimal':
      return 'Minimal signs of depression — little day-to-day impact.';
    case 'mild':
      return 'Mild depression — some low mood, mostly manageable.';
    case 'moderate':
      return 'Moderate depression — a noticeable impact on daily life.';
    case 'moderately_severe':
      return 'Moderately severe depression — a heavy, wearing impact on daily life.';
    case 'severe':
      return 'Severe depression — a serious impact on daily life; needs close attention.';
    default:
      return `${severityLabel(band)} depression (score ${score}).`;
  }
}

/** Short everyday sentence for a GAD-7 (anxiety) result. */
export function gad7Plain(score: number, band: string): string {
  switch (band) {
    case 'minimal':
      return 'Minimal signs of anxiety — little day-to-day impact.';
    case 'mild':
      return 'Mild anxiety — some worry, mostly manageable.';
    case 'moderate':
      return 'Moderate anxiety — a noticeable impact on daily life.';
    case 'moderately_severe':
      return 'Moderately severe anxiety — a heavy, wearing impact on daily life.';
    case 'severe':
      return 'Severe anxiety — a serious impact on daily life; needs close attention.';
    default:
      return `${severityLabel(band)} anxiety (score ${score}).`;
  }
}

/** Reusable one-liner explaining what an AI confidence percentage means. */
export const confidenceHint = 'How sure the AI is — higher confidence is safer to act on.';
