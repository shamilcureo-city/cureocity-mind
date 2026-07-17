/**
 * Sprint DS12 — normalise plan-dictation model drift BEFORE the Zod parse.
 *
 * Mirror of pass3-normalise/differential-normalise: idempotent, non-mutating,
 * and only rewrites KNOWN drift shapes to canonical values. Because this
 * output is proposal-only (a deterministic mapper + the doctor's review tap
 * sit between it and any write), a single malformed edit is DROPPED with an
 * honest clarification appended rather than failing the whole instruction —
 * but unknown values inside a well-formed edit still fail validation loudly.
 */

const ACTION_SYNONYMS: Record<string, string> = {
  addmed: 'addMed',
  addmedication: 'addMed',
  startmed: 'addMed',
  prescribe: 'addMed',
  prescribemed: 'addMed',
  changemed: 'changeMed',
  editmed: 'changeMed',
  updatemed: 'changeMed',
  modifymed: 'changeMed',
  changedose: 'changeMed',
  changemedication: 'changeMed',
  removemed: 'removeMed',
  stopmed: 'removeMed',
  removemedication: 'removeMed',
  discontinuemed: 'removeMed',
  addinvestigation: 'addInvestigation',
  ordertest: 'addInvestigation',
  addtest: 'addInvestigation',
  addorder: 'addInvestigation',
  orderinvestigation: 'addInvestigation',
  removeinvestigation: 'removeInvestigation',
  canceltest: 'removeInvestigation',
  removetest: 'removeInvestigation',
  removeorder: 'removeInvestigation',
  addadvice: 'addAdvice',
  advice: 'addAdvice',
  removeadvice: 'removeAdvice',
  setfollowup: 'setFollowUp',
  followup: 'setFollowUp',
  schedulefollowup: 'setFollowUp',
  clearfollowup: 'clearFollowUp',
  removefollowup: 'clearFollowUp',
};

/** String fields per action → their schema length caps (drift gets clipped). */
const STRING_CAPS: Record<string, number> = {
  drug: 120,
  strength: 60,
  dose: 60,
  frequency: 60,
  timing: 60,
  route: 40,
  name: 200,
  rationale: 300,
  text: 300,
  when: 120,
  withWhat: 200,
};

/** The field a target-bearing action must have a non-empty value for. */
const REQUIRED_FIELD: Record<string, string | null> = {
  addMed: 'drug',
  changeMed: 'drug',
  removeMed: 'drug',
  addInvestigation: 'name',
  removeInvestigation: 'name',
  addAdvice: 'text',
  removeAdvice: 'text',
  setFollowUp: 'when',
  clearFollowUp: null,
};

function coerceString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  // Faithful, unit-free rendering of a bare number ("amlodipine 10" →
  // strength: 10) — never invent a unit the doctor didn't say.
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function coerceDurationDays(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(365, Math.max(1, Math.round(v)));
  }
  if (typeof v === 'string') {
    const m = /(\d+(?:\.\d+)?)\s*([a-z]+)?/i.exec(v.trim());
    if (m?.[1]) {
      // Recognised units only — "3 months" must never quietly become 3 days.
      const unit = (m[2] ?? 'day').toLowerCase();
      const perUnit = /^d(ays?)?$/.test(unit)
        ? 1
        : /^w(ee)?ks?$/.test(unit)
          ? 7
          : /^months?$|^mo$/.test(unit)
            ? 30
            : null;
      if (perUnit === null) return undefined;
      const n = Number.parseFloat(m[1]) * perUnit;
      if (Number.isFinite(n) && n > 0) return Math.min(365, Math.max(1, Math.round(n)));
    }
  }
  return undefined;
}

function normaliseEdit(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const actionRaw = r['action'] ?? r['op'] ?? r['type'] ?? r['kind'];
  if (typeof actionRaw !== 'string') return null;
  const action = ACTION_SYNONYMS[actionRaw.replace(/[\s_-]/g, '').toLowerCase()];
  if (!action) return null;

  const out: Record<string, unknown> = { action };
  for (const [field, cap] of Object.entries(STRING_CAPS)) {
    const v = coerceString(r[field]);
    if (v !== undefined && v.trim() !== '') out[field] = v.trim().slice(0, cap);
  }
  // Common drift: "medication"/"medicine"/"test" instead of drug/name.
  if (out['drug'] === undefined) {
    const alias = coerceString(r['medication'] ?? r['medicine'] ?? r['med']);
    if (alias && alias.trim() !== '') out['drug'] = alias.trim().slice(0, 120);
  }
  if (out['name'] === undefined) {
    const alias = coerceString(r['test'] ?? r['investigation'] ?? r['order']);
    if (alias && alias.trim() !== '') out['name'] = alias.trim().slice(0, 200);
  }
  const duration = coerceDurationDays(r['durationDays'] ?? r['duration'] ?? r['days']);
  if (duration !== undefined) out['durationDays'] = duration;

  const required = REQUIRED_FIELD[action];
  if (required !== null && required !== undefined && out[required] === undefined) return null;
  return out;
}

function coerceClarification(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim().slice(0, 300);
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    const text = r['question'] ?? r['message'] ?? r['text'];
    if (typeof text === 'string' && text.trim() !== '') return text.trim().slice(0, 300);
  }
  return null;
}

export function normalisePlanDictationOutput(raw: unknown): unknown {
  // The model sometimes returns the edits as a bare top-level array.
  const r: Record<string, unknown> = Array.isArray(raw)
    ? { edits: raw }
    : raw && typeof raw === 'object'
      ? { ...(raw as Record<string, unknown>) }
      : {};

  const editsRaw = r['edits'] ?? r['commands'] ?? r['changes'] ?? [];
  const editsIn = Array.isArray(editsRaw) ? editsRaw : [];
  const edits: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const e of editsIn.slice(0, 20)) {
    const n = normaliseEdit(e);
    if (n) edits.push(n);
    else dropped += 1;
  }

  const clarificationsRaw = r['clarifications'] ?? r['questions'] ?? [];
  const clarifications = (Array.isArray(clarificationsRaw) ? clarificationsRaw : [])
    .map(coerceClarification)
    .filter((c): c is string => c !== null)
    .slice(0, 9);
  if (dropped > 0) {
    // Honest about the loss — the doctor sees that part of the instruction
    // didn't land instead of assuming it silently applied.
    clarifications.push(
      `Part of the instruction couldn’t be interpreted (${dropped} edit${
        dropped === 1 ? '' : 's'
      } dropped) — please repeat it.`,
    );
  }

  return { version: 'V1', edits, clarifications };
}
