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
 * The normaliser maps known synonyms to canonical values BEFORE Zod runs.
 * For KIND, an unrecognised value is coerced to the 'other' catch-all (CLIN-3)
 * so a novel crisis is PRESERVED (with its severity + indicators) and rendered
 * with a "review the transcript" banner, instead of the strict parse sinking
 * the whole report and hiding the diagnosis, formulation, AND the crisis. For
 * SEVERITY, an unknown value still falls through to Zod — we never guess how
 * dangerous a crisis is.
 */

const KIND_CANONICAL = new Set([
  'suicidal_ideation',
  'suicidal_plan',
  'harm_to_others',
  'child_safety',
  'intimate_partner_violence',
  'psychosis',
  'substance_emergency',
  'other',
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
      // CLIN-3 — coerce an unrecognised crisis KIND to the 'other' catch-all
      // (after synonym mapping) so a novel presentation is preserved with its
      // severity + indicators rather than sinking the whole report. SEVERITY
      // is deliberately NOT coerced — an unknown severity still fails the Zod
      // parse, because guessing how dangerous a crisis is would be unsafe.
      kind: coerceKind(normaliseEnum(f['kind'], KIND_CANONICAL, KIND_SYNONYMS)),
    }),
    ...(f['severity'] !== undefined && {
      severity: normaliseEnum(f['severity'], SEVERITY_CANONICAL, SEVERITY_SYNONYMS),
    }),
  };
}

function coerceKind(kind: unknown): unknown {
  if (typeof kind !== 'string') return kind;
  return KIND_CANONICAL.has(kind.trim().toLowerCase()) ? kind : 'other';
}

// ============================================================================
// Sprint TSC-V2 — assessment-gap purpose normalisation.
//
// V2 gaps carry an optional `purpose` (safety | differentiate | confirm |
// context). It's optional, so an omitted value parses fine — but a DRIFTED
// value ("differential", "diagnostic", "risk") would fail the enum and sink
// the whole report. We map known synonyms to canonical values and DROP an
// unrecognised purpose (rather than fail): a gap with no purpose still
// renders in the UI's "other" group. `targets` is already a permissive
// string array in the schema, so it needs no coercion here beyond ensuring
// it's an array of strings.
// ============================================================================

const PURPOSE_CANONICAL = new Set(['safety', 'differentiate', 'confirm', 'context']);

const PURPOSE_SYNONYMS: Record<string, string> = {
  risk: 'safety',
  'safety-check': 'safety',
  differential: 'differentiate',
  differentiating: 'differentiate',
  discriminate: 'differentiate',
  'tell-apart': 'differentiate',
  diagnostic: 'differentiate',
  confirmation: 'confirm',
  confirming: 'confirm',
  criterion: 'confirm',
  criteria: 'confirm',
  establish: 'confirm',
  contextual: 'context',
  background: 'context',
  history: 'context',
};

function normaliseGap(gap: unknown): unknown {
  if (!gap || typeof gap !== 'object') return gap;
  const g = gap as Record<string, unknown>;
  const out: Record<string, unknown> = { ...g };

  if (g['purpose'] !== undefined) {
    const canonical = normalisePurpose(g['purpose']);
    if (canonical === undefined) delete out['purpose'];
    else out['purpose'] = canonical;
  }
  // Keep only string targets; drop anything malformed so the array-of-string
  // parse can't fail on a stray object/number the model slipped in.
  if (Array.isArray(g['targets'])) {
    out['targets'] = g['targets'].filter((t): t is string => typeof t === 'string');
  }
  return out;
}

function normalisePurpose(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  if (PURPOSE_CANONICAL.has(key)) return key;
  return PURPOSE_SYNONYMS[key];
}

// ============================================================================
// Copilot IA redesign (R3) — plan-suggestion normalisation.
//
// planSuggestions is OPTIONAL and additive. A drifted `type` ("add-goal",
// "add goal") or a suggestion missing the field its type needs would fail the
// enum / apply step. We uppercase-canonicalise the type and DROP any
// suggestion that is unrecognised or self-inconsistent — a bad plan
// suggestion must never sink the whole report (which carries the diagnosis,
// formulation and crisis). The plan itself is untouched: dropping a
// suggestion just means the therapist doesn't see that one proposed edit.
// ============================================================================

const SUGGESTION_TYPES = new Set([
  'ADD_GOAL',
  'REVISE_GOAL',
  'REMOVE_GOAL',
  'ADJUST_DURATION',
  'CHANGE_MODALITY',
]);

function normaliseSuggestion(s: unknown): unknown | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const type =
    typeof o['type'] === 'string'
      ? o['type']
          .trim()
          .toUpperCase()
          .replace(/[-\s]+/g, '_')
      : '';
  if (!SUGGESTION_TYPES.has(type)) return null;
  if (typeof o['rationale'] !== 'string' || o['rationale'].trim() === '') return null;
  // Drop a suggestion that lacks the payload its type requires — an
  // unappliable suggestion is worse than a missing one.
  const hasGoal = o['goal'] && typeof o['goal'] === 'object';
  const hasIndex = typeof o['goalIndex'] === 'number';
  const hasDuration = typeof o['expectedDurationSessions'] === 'number';
  const hasModality = typeof o['modality'] === 'string';
  if ((type === 'ADD_GOAL' || type === 'REVISE_GOAL') && !hasGoal) return null;
  if ((type === 'REVISE_GOAL' || type === 'REMOVE_GOAL') && !hasIndex) return null;
  if (type === 'ADJUST_DURATION' && !hasDuration) return null;
  if (type === 'CHANGE_MODALITY' && !hasModality) return null;
  return { ...o, type };
}

// ============================================================================
// The Session Loop (SL1) — formulation-suggestion normalisation. Same policy
// as plan suggestions: canonicalise the enums, DROP anything unrecognised or
// self-inconsistent — a bad formulation suggestion must never sink the report.
// ============================================================================

const FORMULATION_TARGETS = new Set([
  'NARRATIVE',
  'CYCLE',
  'PREDISPOSING',
  'PRECIPITATING',
  'PERPETUATING',
  'PROTECTIVE',
  'PREDICTION',
]);
const FORMULATION_ACTIONS = new Set(['ADD', 'REVISE']);
const CYCLE_ROLES = new Set(['TRIGGER', 'THOUGHT', 'FEELING', 'BEHAVIOUR', 'CONSEQUENCE']);

function normaliseFormulationSuggestion(s: unknown): unknown | null {
  if (!s || typeof s !== 'object') return null;
  const o = s as Record<string, unknown>;
  const up = (v: unknown): string =>
    typeof v === 'string'
      ? v
          .trim()
          .toUpperCase()
          .replace(/[-\s]+/g, '_')
      : '';
  const target = up(o['target']);
  const action = up(o['action']);
  if (!FORMULATION_TARGETS.has(target) || !FORMULATION_ACTIONS.has(action)) return null;
  if (typeof o['text'] !== 'string' || o['text'].trim() === '') return null;
  const roleRaw = up(o['cycleRole']);
  // US spelling drift on the one enum value where it can happen.
  const role = roleRaw === 'BEHAVIOR' ? 'BEHAVIOUR' : roleRaw;
  return {
    ...o,
    target,
    action,
    cycleRole: CYCLE_ROLES.has(role) ? role : null,
    evidenceQuote: typeof o['evidenceQuote'] === 'string' ? o['evidenceQuote'] : null,
  };
}

/**
 * Walks the raw Pass 3 JSON (intake brief or clinical report) and
 * normalises every `crisisFlags[].kind` and `crisisFlags[].severity`
 * to a canonical enum value, every `assessmentGaps[].purpose` to a
 * canonical assessment-engine purpose (dropping unknowns), and every
 * `planSuggestions[]` / `formulationSuggestions[]` (dropping unappliable
 * ones). Idempotent. Returns a new object — the input is not mutated.
 */
export function normalisePass3Output(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };
  if (Array.isArray(r['crisisFlags'])) out['crisisFlags'] = r['crisisFlags'].map(normaliseFlag);
  if (Array.isArray(r['assessmentGaps'])) {
    out['assessmentGaps'] = r['assessmentGaps'].map(normaliseGap);
  }
  if (Array.isArray(r['planSuggestions'])) {
    out['planSuggestions'] = r['planSuggestions']
      .map(normaliseSuggestion)
      .filter((s) => s !== null);
  }
  if (Array.isArray(r['formulationSuggestions'])) {
    out['formulationSuggestions'] = r['formulationSuggestions']
      .map(normaliseFormulationSuggestion)
      .filter((s) => s !== null);
  }
  return out;
}
