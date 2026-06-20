/**
 * Pass 3 (Clinical Analysis) — defensive normaliser.
 *
 * Gemini occasionally drifts from the canonical enum values for
 * `crisisFlags[].kind` and `crisisFlags[].severity` despite the prompt
 * pinning them explicitly. Examples seen in production:
 *
 *   - kind: "suicidal-ideation-risk"   (dashes + "-risk" suffix)
 *   - severity: "moderate"             (invented 5th value)
 *
 * A strict Zod parse then rejects the ENTIRE brief / report, leaving
 * the AI Copilot tab in a permanent failed state. Retrying picks the
 * same vocabulary on this seed.
 *
 * The normaliser maps known synonyms to canonical values BEFORE Zod
 * runs. Anything that still doesn't match falls through and lets Zod
 * report it (we don't silently drop unknown crises — clinical safety).
 */

const KIND_CANONICAL = new Set([
  'suicidal_ideation',
  'suicidal_plan',
  'harm_to_others',
  'child_safety',
  'intimate_partner_violence',
  'psychosis',
  'substance_emergency',
]);

const KIND_SYNONYMS: Record<string, string> = {
  // Gemini's observed drift — dashes, "-risk" suffix, spaces.
  'suicidal-ideation-risk': 'suicidal_ideation',
  'suicidal-ideation': 'suicidal_ideation',
  suicide_ideation: 'suicidal_ideation',
  suicide: 'suicidal_ideation',
  self_harm: 'suicidal_ideation',
  'self-harm': 'suicidal_ideation',

  'suicidal-plan': 'suicidal_plan',
  suicide_plan: 'suicidal_plan',

  'harm-to-others': 'harm_to_others',
  homicidal_ideation: 'harm_to_others',
  violence_to_others: 'harm_to_others',

  'child-safety': 'child_safety',
  child_abuse: 'child_safety',
  'child-abuse': 'child_safety',

  'intimate-partner-violence': 'intimate_partner_violence',
  domestic_violence: 'intimate_partner_violence',
  'domestic-violence': 'intimate_partner_violence',
  ipv: 'intimate_partner_violence',

  'substance-emergency': 'substance_emergency',
  overdose: 'substance_emergency',
  substance_overdose: 'substance_emergency',
};

const SEVERITY_CANONICAL = new Set(['low', 'medium', 'high', 'critical']);

const SEVERITY_SYNONYMS: Record<string, string> = {
  // Gemini's observed drift on the severity ladder.
  moderate: 'medium',
  mild: 'low',
  minor: 'low',
  severe: 'high',
  extreme: 'critical',
  imminent: 'critical',
  life_threatening: 'critical',
  'life-threatening': 'critical',
};

function normaliseEnum(
  raw: unknown,
  canonical: Set<string>,
  synonyms: Record<string, string>,
): unknown {
  if (typeof raw !== 'string') return raw;
  const key = raw.trim().toLowerCase();
  if (canonical.has(key)) return key;
  return synonyms[key] ?? raw;
}

function normaliseFlag(flag: unknown): unknown {
  if (!flag || typeof flag !== 'object') return flag;
  const f = flag as Record<string, unknown>;
  return {
    ...f,
    ...(f['kind'] !== undefined && {
      kind: normaliseEnum(f['kind'], KIND_CANONICAL, KIND_SYNONYMS),
    }),
    ...(f['severity'] !== undefined && {
      severity: normaliseEnum(f['severity'], SEVERITY_CANONICAL, SEVERITY_SYNONYMS),
    }),
  };
}

/**
 * Walks the raw Pass 3 JSON (intake brief or clinical report) and
 * normalises every `crisisFlags[].kind` and `crisisFlags[].severity`
 * to a canonical enum value. Idempotent. Returns a new object —
 * the input is not mutated.
 */
export function normalisePass3Output(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const flags = r['crisisFlags'];
  if (!Array.isArray(flags)) return raw;
  return { ...r, crisisFlags: flags.map(normaliseFlag) };
}
