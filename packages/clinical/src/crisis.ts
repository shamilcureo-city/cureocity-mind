/**
 * Sprint 17 — Curated India crisis-pathway resources.
 *
 * Hotlines + walk-in services to surface in the Clinical Brief
 * crisis banner and as defaults in the SafetyPlan UI.
 *
 * All numbers + availability blocks verified 2026-06; revisit
 * annually as services may discontinue or change hours.
 */

export interface CrisisHotline {
  /** Display name. */
  name: string;
  /** Phone number including country code formatting the patient sees. */
  number: string;
  /** Service availability ("24×7" / "Mon-Sat, 8am-10pm"). */
  hours: string;
  /** Languages supported, in ISO 639-1 codes. */
  languages: string[];
  /** Short blurb about what the line offers. */
  description: string;
  /** Geography. "IN" for India-wide, otherwise a state code. */
  region: 'IN' | string;
  /** Whether the line is the recommended first-call for the given kind. */
  recommendedFor: Array<
    | 'suicidal_ideation'
    | 'suicidal_plan'
    | 'harm_to_others'
    | 'child_safety'
    | 'intimate_partner_violence'
    | 'psychosis'
    | 'substance_emergency'
    | 'general'
  >;
}

export const INDIA_CRISIS_HOTLINES: CrisisHotline[] = [
  {
    name: 'iCall (TISS)',
    number: '9152987821',
    hours: 'Mon-Sat, 8am-10pm',
    languages: ['en', 'hi', 'mr', 'ml', 'ta', 'bn', 'gu'],
    description:
      'Free counselling helpline run by TISS School of Human Ecology. Trained counsellors; multilingual.',
    region: 'IN',
    recommendedFor: ['suicidal_ideation', 'general'],
  },
  {
    name: 'Vandrevala Foundation',
    number: '1860-2662-345',
    hours: '24×7',
    languages: ['en', 'hi'],
    description: 'Free mental-health support line; 24-hour coverage.',
    region: 'IN',
    recommendedFor: ['suicidal_ideation', 'suicidal_plan', 'general'],
  },
  {
    name: 'NIMHANS Helpline',
    number: '080-46110007',
    hours: '24×7',
    languages: ['en', 'hi', 'kn'],
    description:
      'Run by the National Institute of Mental Health and Neuro-Sciences (Bengaluru). 24-hour psychiatric helpline.',
    region: 'IN',
    recommendedFor: ['suicidal_plan', 'psychosis', 'general'],
  },
  {
    name: 'Childline India',
    number: '1098',
    hours: '24×7',
    languages: ['en', 'hi'],
    description: 'National helpline for children in distress; trained counsellors + rescue ops.',
    region: 'IN',
    recommendedFor: ['child_safety'],
  },
  {
    name: 'Women Helpline (181)',
    number: '181',
    hours: '24×7',
    languages: ['en', 'hi'],
    description: 'National helpline for women facing violence, harassment, or distress.',
    region: 'IN',
    recommendedFor: ['intimate_partner_violence'],
  },
];

/**
 * Pick the most relevant 3 hotlines for a given crisis kind. Always
 * includes a general 24×7 line at the bottom so the patient has a
 * fallback.
 */
export function hotlinesForCrisisKind(
  kind: CrisisHotline['recommendedFor'][number],
): CrisisHotline[] {
  const matched = INDIA_CRISIS_HOTLINES.filter((h) => h.recommendedFor.includes(kind));
  const general = INDIA_CRISIS_HOTLINES.filter(
    (h) => h.recommendedFor.includes('general') && h.hours === '24×7',
  );
  const seen = new Set<string>();
  const picked: CrisisHotline[] = [];
  for (const h of [...matched, ...general]) {
    if (!seen.has(h.name)) {
      seen.add(h.name);
      picked.push(h);
      if (picked.length >= 3) break;
    }
  }
  return picked;
}
