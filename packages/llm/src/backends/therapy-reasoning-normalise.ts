/**
 * Sprint TS5 — PASS_12_THERAPY_REASONING defensive normaliser.
 *
 * Runs on the raw model JSON BEFORE the Zod parse. Like the doctor reasoning
 * normaliser it maps the drift we expect (severity synonyms), and it forces
 * `source: "LIVE"` on every model-emitted risk/ask item — the CARRIED and
 * CARRIED_RISK sources are gateway-seeded and must never come from the model.
 * Non-string sourceUtteranceIds are dropped so the array-of-string parse can't
 * fail on a stray object. Idempotent; returns a new object.
 */

const SEVERITY_CANONICAL = new Set(['low', 'medium', 'high', 'critical']);
const SEVERITY_SYNONYMS: Record<string, string> = {
  moderate: 'medium',
  mild: 'low',
  minor: 'low',
  severe: 'high',
  extreme: 'critical',
  imminent: 'critical',
};

function normaliseSeverity(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const key = raw.trim().toLowerCase();
  if (SEVERITY_CANONICAL.has(key)) return key;
  return SEVERITY_SYNONYMS[key] ?? raw;
}

function stringIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((v): v is string => typeof v === 'string');
}

function normaliseRisk(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const r = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r, source: 'LIVE' };
  if (r['severity'] !== undefined) out['severity'] = normaliseSeverity(r['severity']);
  const ids = stringIds(r['sourceUtteranceIds']);
  if (ids !== undefined) out['sourceUtteranceIds'] = ids;
  return out;
}

function normaliseAsk(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const a = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...a, source: 'LIVE' };
  const ids = stringIds(a['sourceUtteranceIds']);
  if (ids !== undefined) out['sourceUtteranceIds'] = ids;
  return out;
}

function normaliseThread(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const t = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...t };
  const ids = stringIds(t['sourceUtteranceIds']);
  if (ids !== undefined) out['sourceUtteranceIds'] = ids;
  return out;
}

export function normaliseTherapyReasoningOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (Array.isArray(r['riskWatch'])) out['riskWatch'] = r['riskWatch'].map(normaliseRisk);
  if (Array.isArray(r['askNext'])) out['askNext'] = r['askNext'].map(normaliseAsk);
  if (Array.isArray(r['threads'])) out['threads'] = r['threads'].map(normaliseThread);
  return out;
}
