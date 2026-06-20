import type { VoiceCommand } from '@cureocity/contracts';

/**
 * Sprint DV6.4 — deterministic mid-consult voice-command parser.
 *
 * Scans the (rolling) transcript for spoken commands a doctor issues in
 * front of the patient — "add paracetamol 500 TDS x 3 days", "order ECG",
 * "show last HbA1c". Rule-based, NO LLM, conservative on purpose: a
 * medication command must carry a strength OR a frequency code, and an
 * order/show command must name a known test/measure — so ordinary
 * conversation doesn't trigger false actions. The doctor confirms
 * everything; nothing here is auto-applied. See
 * docs/DOCTOR_VERTICAL_SPRINTS.md DV6.4.
 */

/** Indian-OPD dosing shorthand → plain English. */
const FREQUENCY_CODES: Record<string, string> = {
  od: 'once daily',
  bd: 'twice daily',
  bid: 'twice daily',
  tds: 'three times daily',
  tid: 'three times daily',
  qid: 'four times daily',
  qds: 'four times daily',
  hs: 'at night',
  sos: 'as needed',
  prn: 'as needed',
  stat: 'immediately (stat)',
};

/** Known investigations, so "order …" only fires on a real test. */
const TEST_KEYWORDS = [
  'ecg',
  'ekg',
  'echo',
  'x-ray',
  'xray',
  'chest x-ray',
  'ct',
  'mri',
  'ultrasound',
  'usg',
  'lipid profile',
  'lipid',
  'hba1c',
  'cbc',
  'lft',
  'kft',
  'rft',
  'troponin',
  'blood sugar',
  'fasting sugar',
  'urine routine',
  'urine',
  'culture',
  'biopsy',
  'thyroid',
  'tsh',
  'creatinine',
];

type ShowMeasure = Extract<VoiceCommand, { kind: 'SHOW_DATA' }>['measure'];
const MEASURE_KEYWORDS: { pattern: RegExp; measure: ShowMeasure }[] = [
  { pattern: /\b(bp|blood pressure)\b/, measure: 'BP' },
  { pattern: /\b(hba1c|a1c)\b/, measure: 'HBA1C' },
  { pattern: /\b(fbs|fasting (?:blood )?sugar|fasting glucose)\b/, measure: 'FBS' },
  { pattern: /\b(ldl|cholesterol)\b/, measure: 'LDL' },
  { pattern: /\b(weight)\b/, measure: 'WEIGHT' },
  { pattern: /\bsugar\b/, measure: 'FBS' },
];

const STRENGTH_RE = /\b(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml|units?|iu)\b/i;
const FREQ_RE = /\b(od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat)\b/i;
const DURATION_RE = /\b(?:x|×|for)\s*(\d+)\s*(day|days|week|weeks|wk|wks)\b/i;

/** Split a transcript into command-sized clauses. */
function clauses(transcript: string): string[] {
  return transcript
    .split(/[.\n;?!]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function parseClause(clause: string): VoiceCommand | null {
  const lower = clause.toLowerCase();

  // ADD_MEDICATION — needs a dosing signal so plain "add a note" is ignored.
  const medTrigger = /\b(add|start|prescribe|give|put (?:him|her|them) on)\b/.exec(lower);
  const strengthMatch = STRENGTH_RE.exec(clause);
  const freqMatch = FREQ_RE.exec(lower);
  if (medTrigger && (strengthMatch || freqMatch)) {
    const durationMatch = DURATION_RE.exec(lower);
    // The drug name = words after the trigger, before the first dosing token.
    const afterTrigger = clause.slice(medTrigger.index + medTrigger[0].length).trim();
    const cutAt = [
      strengthMatch ? afterTrigger.toLowerCase().indexOf(strengthMatch[0].toLowerCase()) : -1,
      freqMatch ? afterTrigger.toLowerCase().indexOf(freqMatch[0].toLowerCase()) : -1,
    ].filter((i) => i >= 0);
    const drugEnd = cutAt.length > 0 ? Math.min(...cutAt) : afterTrigger.length;
    const drug = titleCase(
      afterTrigger
        .slice(0, drugEnd)
        .replace(/\b(tab|tablet|cap|capsule)\b/gi, '')
        .trim(),
    );
    if (drug.length === 0) return null;
    const durationDays = durationMatch
      ? /(week|wk)/.test(durationMatch[2]!.toLowerCase())
        ? Number(durationMatch[1]) * 7
        : Number(durationMatch[1])
      : undefined;
    return {
      kind: 'ADD_MEDICATION',
      raw: clause,
      drug,
      ...(strengthMatch && { strength: `${strengthMatch[1]} ${strengthMatch[2]!.toLowerCase()}` }),
      ...(freqMatch && { frequency: FREQUENCY_CODES[freqMatch[1]!.toLowerCase()] ?? freqMatch[1] }),
      ...(durationDays !== undefined && { durationDays }),
    };
  }

  // ORDER_TEST — an order verb + a known investigation.
  if (/\b(order|send (?:for|him|her|them)|get an?|repeat|investigate)\b/.test(lower)) {
    const test = TEST_KEYWORDS.find((t) => lower.includes(t));
    if (test) {
      return { kind: 'ORDER_TEST', raw: clause, description: titleCase(test) };
    }
  }

  // SHOW_DATA — a retrieval verb + a known measure.
  if (/\b(show|pull up|what(?:'s| is| was| were)|last|previous|check)\b/.test(lower)) {
    for (const m of MEASURE_KEYWORDS) {
      if (m.pattern.test(lower)) {
        return { kind: 'SHOW_DATA', raw: clause, measure: m.measure };
      }
    }
  }

  return null;
}

/** Parse every recognised command in a transcript (deduped by clause). */
export function parseVoiceCommands(transcript: string): VoiceCommand[] {
  const out: VoiceCommand[] = [];
  const seen = new Set<string>();
  for (const clause of clauses(transcript)) {
    const cmd = parseClause(clause);
    if (!cmd) continue;
    if (seen.has(cmd.raw)) continue;
    seen.add(cmd.raw);
    out.push(cmd);
  }
  return out;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
