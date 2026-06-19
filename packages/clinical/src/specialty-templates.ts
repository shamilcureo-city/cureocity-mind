/**
 * Sprint DV6.3 — specialty note templates.
 *
 * A super-specialty OPD consult has specialty-specific documentation
 * expectations: a cardiology follow-up is not a nephrology review. Each
 * template names the HPI / ROS / exam / vitals elements that SHOULD be
 * documented for that specialty; the deterministic completeness checker
 * (`missingTemplateElements`) drives the Rail-3 ❓ "not yet documented"
 * nudges. Start with cardiology (the DV-segment pick); add specialties
 * with clinician sign-off. Rule-based, no LLM. See
 * docs/DOCTOR_VERTICAL.md §2, §7; docs/DOCTOR_VERTICAL_SPRINTS.md DV6.3.
 */

export type TemplateElementCategory = 'HPI' | 'ROS' | 'EXAM' | 'VITALS';

export interface TemplateElement {
  /** Stable id. */
  id: string;
  /** What the doctor should have documented. */
  label: string;
  /** Lowercase keywords; the element is "documented" if any appears. */
  cues: string[];
}

export interface SpecialtyTemplate {
  key: string;
  label: string;
  hpi: TemplateElement[];
  ros: TemplateElement[];
  exam: TemplateElement[];
  /** Vital keys expected for this specialty (matches VitalsSchema keys). */
  vitals: { id: string; label: string }[];
}

const CARDIOLOGY: SpecialtyTemplate = {
  key: 'cardiology',
  label: 'Cardiology',
  hpi: [
    {
      id: 'chest-pain-character',
      label: 'Chest pain character',
      cues: ['chest', 'angina', 'pressure', 'tightness'],
    },
    {
      id: 'exertion',
      label: 'Relation to exertion',
      cues: ['exert', 'walking', 'climbing', 'rest', 'activity'],
    },
    {
      id: 'dyspnea',
      label: 'Dyspnoea / orthopnoea',
      cues: ['breath', 'dyspn', 'orthopn', 'pnd', 'short of breath'],
    },
    {
      id: 'palpitations',
      label: 'Palpitations / syncope',
      cues: ['palpitation', 'syncope', 'faint', 'dizzy'],
    },
  ],
  ros: [
    { id: 'edema', label: 'Pedal oedema', cues: ['edema', 'oedema', 'swelling', 'ankle'] },
    { id: 'claudication', label: 'Claudication', cues: ['claudicat', 'leg pain', 'calf'] },
  ],
  exam: [
    {
      id: 'heart-sounds',
      label: 'Heart sounds / murmur',
      cues: ['s1', 's2', 'murmur', 'heart sound', 'apex'],
    },
    { id: 'jvp', label: 'JVP', cues: ['jvp', 'jugular'] },
    {
      id: 'lung-bases',
      label: 'Lung bases / crepitations',
      cues: ['crep', 'crackle', 'basal', 'air entry'],
    },
  ],
  vitals: [
    { id: 'bp', label: 'Blood pressure' },
    { id: 'hr', label: 'Heart rate' },
  ],
};

const ENDOCRINOLOGY: SpecialtyTemplate = {
  key: 'endocrinology',
  label: 'Endocrinology',
  hpi: [
    {
      id: 'glycaemic',
      label: 'Glycaemic symptoms',
      cues: ['thirst', 'polyuria', 'polydipsia', 'sugar', 'glucose', 'hypo'],
    },
    { id: 'weight', label: 'Weight change', cues: ['weight', 'appetite'] },
    {
      id: 'adherence',
      label: 'Medication adherence',
      cues: ['adher', 'compliance', 'missed dose', 'taking'],
    },
  ],
  ros: [
    {
      id: 'neuropathy',
      label: 'Neuropathy symptoms',
      cues: ['numb', 'tingl', 'neuropath', 'foot'],
    },
    { id: 'vision', label: 'Visual symptoms', cues: ['vision', 'blurred', 'eye'] },
  ],
  exam: [
    {
      id: 'foot-exam',
      label: 'Diabetic foot exam',
      cues: ['foot', 'pulse', 'monofilament', 'ulcer'],
    },
  ],
  vitals: [
    { id: 'bp', label: 'Blood pressure' },
    { id: 'weight', label: 'Weight' },
  ],
};

export const SPECIALTY_TEMPLATES: Record<string, SpecialtyTemplate> = {
  cardiology: CARDIOLOGY,
  endocrinology: ENDOCRINOLOGY,
};

/** Resolve a free-text specialty string to a template, or null. */
export function resolveSpecialtyTemplate(specialty?: string | null): SpecialtyTemplate | null {
  if (!specialty) return null;
  const key = specialty.trim().toLowerCase();
  if (SPECIALTY_TEMPLATES[key]) return SPECIALTY_TEMPLATES[key]!;
  // tolerant contains-match ("Interventional Cardiology" → cardiology)
  for (const [k, t] of Object.entries(SPECIALTY_TEMPLATES)) {
    if (key.includes(k)) return t;
  }
  return null;
}

/** The note fields the completeness checker reads — kept primitive so the
 *  checker is trivially testable and decoupled from the note schema. */
export interface EncounterCompletenessInput {
  hpi: string;
  reviewOfSystems: string[];
  examined: boolean;
  examFindings: string;
  /** Vital ids actually recorded, e.g. ['bp','hr']. */
  presentVitals: string[];
}

export interface TemplateGap {
  category: TemplateElementCategory;
  elementId: string;
  message: string;
}

function documented(haystack: string, cues: string[]): boolean {
  return cues.some((c) => haystack.includes(c));
}

/**
 * Return the template elements NOT yet documented for this encounter.
 * Deterministic keyword match — conservative (a present cue suppresses
 * the nudge). Empty array when there's no template for the specialty.
 */
export function missingTemplateElements(
  input: EncounterCompletenessInput,
  template: SpecialtyTemplate | null,
): TemplateGap[] {
  if (!template) return [];
  const gaps: TemplateGap[] = [];

  const hpiHay = input.hpi.toLowerCase();
  const rosHay = input.reviewOfSystems.join(' \n ').toLowerCase();
  const hpiRosHay = `${hpiHay}\n${rosHay}`;
  const examHay = input.examFindings.toLowerCase();
  const vitals = new Set(input.presentVitals.map((v) => v.toLowerCase()));

  for (const el of template.hpi) {
    if (!documented(hpiRosHay, el.cues)) {
      gaps.push({ category: 'HPI', elementId: el.id, message: `${el.label} not documented yet.` });
    }
  }
  for (const el of template.ros) {
    if (!documented(hpiRosHay, el.cues)) {
      gaps.push({ category: 'ROS', elementId: el.id, message: `${el.label} not asked yet.` });
    }
  }
  for (const el of template.exam) {
    // Only flag exam elements once an exam has been performed — don't
    // nag for a murmur when no exam was done (that's the PE guard's job).
    if (input.examined && !documented(examHay, el.cues)) {
      gaps.push({ category: 'EXAM', elementId: el.id, message: `${el.label} not documented.` });
    }
  }
  for (const v of template.vitals) {
    if (!vitals.has(v.id)) {
      gaps.push({ category: 'VITALS', elementId: v.id, message: `${v.label} not recorded.` });
    }
  }
  return gaps;
}
