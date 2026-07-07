/**
 * Differential pass — defensive normaliser (mirror of pass3-normalise).
 *
 * Gemini drifts from DifferentialDiagnosisV1's canonical shapes despite
 * the prompt pinning them. Observed in production (2026-07-06):
 *
 *   - redFlagsToExclude[]: objects like {"flag": "...", "rationale": "..."}
 *     where the schema wants plain strings
 *   - codingNudges[].severity: "INFO" / "WARNING" (uppercase, invented
 *     WARNING) where the schema wants 'info' | 'warn'
 *   - codingNudges[].kind: lowercase / dashed variants of the enum
 *
 * A strict Zod parse then rejects the ENTIRE differential and the raw
 * ZodError text lands in the encounter UI. The normaliser maps known
 * drift to canonical values BEFORE Zod runs; anything else still fails
 * validation loudly (clinical safety — never silently invent content).
 */

const SEVERITY_SYNONYMS: Record<string, string> = {
  info: 'info',
  information: 'info',
  informational: 'info',
  note: 'info',
  warn: 'warn',
  warning: 'warn',
  caution: 'warn',
};

const NUDGE_KIND_CANONICAL = new Set(['SUGGESTED_CODE', 'UNDERCODING', 'DOCUMENTATION_GAP']);

const NUDGE_KIND_SYNONYMS: Record<string, string> = {
  suggested_code: 'SUGGESTED_CODE',
  'suggested-code': 'SUGGESTED_CODE',
  suggestion: 'SUGGESTED_CODE',
  undercoding: 'UNDERCODING',
  'under-coding': 'UNDERCODING',
  documentation_gap: 'DOCUMENTATION_GAP',
  'documentation-gap': 'DOCUMENTATION_GAP',
  doc_gap: 'DOCUMENTATION_GAP',
};

/** An object-shaped red flag → its most plausible string form. */
function redFlagToString(entry: unknown): unknown {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return entry;
  const e = entry as Record<string, unknown>;
  // Common shapes seen: {flag}, {redFlag}, {name}, {condition}, {message},
  // {description}, optionally with a rationale we fold in after an em dash.
  const label = [e['flag'], e['redFlag'], e['name'], e['condition'], e['message'], e['label']].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  if (!label) return entry;
  const rationale = [e['rationale'], e['reason'], e['description'], e['why']].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return rationale && rationale !== label ? `${label} — ${rationale}` : label;
}

function normaliseNudge(nudge: unknown): unknown {
  if (!nudge || typeof nudge !== 'object') return nudge;
  const n = nudge as Record<string, unknown>;
  const out: Record<string, unknown> = { ...n };
  const rawSeverity = n['severity'];
  if (typeof rawSeverity === 'string') {
    out['severity'] = SEVERITY_SYNONYMS[rawSeverity.trim().toLowerCase()] ?? rawSeverity;
  }
  const rawKind = n['kind'];
  if (typeof rawKind === 'string' && !NUDGE_KIND_CANONICAL.has(rawKind)) {
    out['kind'] = NUDGE_KIND_SYNONYMS[rawKind.trim().toLowerCase()] ?? rawKind;
  }
  return out;
}

/**
 * Walks the raw differential JSON and normalises `redFlagsToExclude[]`
 * to strings and `codingNudges[].{severity,kind}` to canonical enum
 * values. Idempotent; returns a new object — the input is not mutated.
 */
export function normaliseDifferentialOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (Array.isArray(r['redFlagsToExclude'])) {
    out['redFlagsToExclude'] = r['redFlagsToExclude'].map(redFlagToString);
  }
  if (Array.isArray(r['codingNudges'])) {
    out['codingNudges'] = r['codingNudges'].map(normaliseNudge);
  }
  return out;
}
