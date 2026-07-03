/**
 * Sprint DS2 — PassReasoning defensive normaliser (à la pass3-normalise).
 *
 * Flash drifts from the canonical enum vocabulary despite the prompt pinning
 * it — likelihood "medium"/"possible", trend "increasing", ask-next priority
 * "urgent", finding polarity "positive". A strict Zod parse then rejects the
 * ENTIRE reasoning snapshot, blanking the copilot mid-consult. This maps
 * known synonyms to canonical values BEFORE Zod runs. Anything still unknown
 * falls through to Zod (we don't silently invent clinical values). Idempotent;
 * returns a new object — the input is not mutated.
 */

const LIKELIHOOD_CANONICAL = new Set(['high', 'moderate', 'low']);
const LIKELIHOOD_SYNONYMS: Record<string, string> = {
  medium: 'moderate',
  mid: 'moderate',
  possible: 'low',
  unlikely: 'low',
  probable: 'high',
  likely: 'high',
  'very high': 'high',
  'very likely': 'high',
};

const TREND_CANONICAL = new Set(['new', 'up', 'down', 'steady']);
const TREND_SYNONYMS: Record<string, string> = {
  increasing: 'up',
  rising: 'up',
  increased: 'up',
  higher: 'up',
  decreasing: 'down',
  falling: 'down',
  decreased: 'down',
  lower: 'down',
  unchanged: 'steady',
  stable: 'steady',
  same: 'steady',
  added: 'new',
};

const PRIORITY_CANONICAL = new Set(['high', 'normal']);
const PRIORITY_SYNONYMS: Record<string, string> = {
  urgent: 'high',
  critical: 'high',
  important: 'high',
  low: 'normal',
  medium: 'normal',
  standard: 'normal',
  routine: 'normal',
};

const POLARITY_CANONICAL = new Set(['present', 'denied', 'unknown']);
const POLARITY_SYNONYMS: Record<string, string> = {
  positive: 'present',
  yes: 'present',
  affirmed: 'present',
  negative: 'denied',
  absent: 'denied',
  no: 'denied',
  ruled_out: 'denied',
  'ruled-out': 'denied',
  uncertain: 'unknown',
  unsure: 'unknown',
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function normaliseFinding(f: unknown): unknown {
  const r = asRecord(f);
  if (!r) return f;
  return {
    ...r,
    ...(r['polarity'] !== undefined && {
      polarity: normaliseEnum(r['polarity'], POLARITY_CANONICAL, POLARITY_SYNONYMS),
    }),
  };
}

function normaliseDifferential(d: unknown): unknown {
  const r = asRecord(d);
  if (!r) return d;
  return {
    ...r,
    ...(r['likelihood'] !== undefined && {
      likelihood: normaliseEnum(r['likelihood'], LIKELIHOOD_CANONICAL, LIKELIHOOD_SYNONYMS),
    }),
    ...(r['trend'] !== undefined && {
      trend: normaliseEnum(r['trend'], TREND_CANONICAL, TREND_SYNONYMS),
    }),
  };
}

function normaliseAskNext(a: unknown): unknown {
  const r = asRecord(a);
  if (!r) return a;
  return {
    ...r,
    ...(r['priority'] !== undefined && {
      priority: normaliseEnum(r['priority'], PRIORITY_CANONICAL, PRIORITY_SYNONYMS),
    }),
  };
}

/** Normalise a raw PassReasoning JSON payload before Zod parses it. */
export function normaliseReasoningOutput(raw: unknown): unknown {
  const r = asRecord(raw);
  if (!r) return raw;
  const out: Record<string, unknown> = { ...r };
  if (Array.isArray(r['findings'])) out['findings'] = r['findings'].map(normaliseFinding);
  if (Array.isArray(r['differential']))
    out['differential'] = r['differential'].map(normaliseDifferential);
  if (Array.isArray(r['askNext'])) out['askNext'] = r['askNext'].map(normaliseAskNext);
  return out;
}
