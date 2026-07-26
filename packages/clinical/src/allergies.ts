/**
 * Batch B — deterministic drug-allergy checker.
 *
 * The sibling of `interactions.ts`. The Rx pad has always CARRIED the
 * patient's allergy list (`RxPadV1.allergies`) and printed it on the
 * prescription — but nothing ever checked a prescribed drug against it. A
 * penicillin-allergic patient could be handed amoxicillin with the allergy
 * printed at the top of the same slip. This closes that.
 *
 * Rule-based, citation-bearing, no external API and no LLM — same posture as
 * the interaction engine. Deliberately conservative in BOTH directions:
 *
 *   • It only warns on drugs and allergens it recognises. An unrecognised
 *     drug is never flagged — the prescriber stays responsible for the rest.
 *   • It does NOT invent cross-reactivity. The classic false-alarm generator
 *     is treating a sulfonamide-ANTIBIOTIC allergy as a contraindication to
 *     thiazides / furosemide / celecoxib; the evidence does not support
 *     meaningful cross-reactivity there, so those are deliberately absent.
 *
 * DO NOT loosen a `contraindicated` severity, and do not add a cross-reactive
 * pair, without a pharmacology citation — these gate a safety flag in front
 * of a prescriber and, at `contraindicated`, block a signature.
 */

export type AllergyMatch = 'direct' | 'class' | 'cross-reactive';
export type AllergySeverity = 'contraindicated' | 'major';

export interface AllergyAlert {
  severity: AllergySeverity;
  /** The prescribed drug, as the doctor wrote it. */
  drug: string;
  /** Canonical name of what was matched (generic or class). */
  matched: string;
  /** The recorded allergy this fired against, as recorded. */
  allergy: string;
  match: AllergyMatch;
  mechanism: string;
  advice: string;
  source: string;
}

/**
 * Allergen classes and the drugs that belong to them. Generics plus the
 * Indian brand names an OPD prescriber actually types. Keys are matched on a
 * word-ish boundary, so "amoxicillin 500" resolves and "amoxicillinoid"
 * does not.
 */
const ALLERGEN_CLASSES: Record<string, { label: string; members: string[] }> = {
  penicillin: {
    label: 'Penicillins',
    members: [
      'penicillin',
      'benzylpenicillin',
      'benzathine',
      'amoxicillin',
      'amoxycillin',
      'amoxyclav',
      'augmentin',
      'clavam',
      'mox',
      'ampicillin',
      'ampiclox',
      'cloxacillin',
      'piperacillin',
      'tazobactam',
    ],
  },
  cephalosporin: {
    label: 'Cephalosporins',
    members: [
      'cephalosporin',
      'cephalexin',
      'cefalexin',
      'cefadroxil',
      'cefuroxime',
      'cefixime',
      'cefpodoxime',
      'ceftriaxone',
      'cefotaxime',
      'ceftazidime',
      'taxim',
      'monocef',
      'zifi',
    ],
  },
  sulfonamide: {
    label: 'Sulfonamide antibiotics',
    members: [
      'sulfa',
      'sulpha',
      'sulfonamide',
      'sulphonamide',
      'sulfamethoxazole',
      'cotrimoxazole',
      'co-trimoxazole',
      'trimethoprim',
      'septran',
      'bactrim',
      'sulfadiazine',
      'sulfasalazine',
    ],
  },
  nsaid: {
    label: 'NSAIDs',
    members: [
      'nsaid',
      'nsaids',
      'ibuprofen',
      'brufen',
      'combiflam',
      'diclofenac',
      'voveran',
      'aceclofenac',
      'naproxen',
      'ketorolac',
      'indomethacin',
      'nimesulide',
      'mefenamic',
      'meftal',
      'piroxicam',
      'etoricoxib',
      'aspirin',
      'ecosprin',
      'disprin',
    ],
  },
  macrolide: {
    label: 'Macrolides',
    members: [
      'macrolide',
      'erythromycin',
      'azithromycin',
      'azithral',
      'azee',
      'clarithromycin',
      'roxithromycin',
    ],
  },
  quinolone: {
    label: 'Fluoroquinolones',
    members: [
      'quinolone',
      'fluoroquinolone',
      'ciprofloxacin',
      'cifran',
      'levofloxacin',
      'ofloxacin',
      'norfloxacin',
      'moxifloxacin',
    ],
  },
  tetracycline: {
    label: 'Tetracyclines',
    members: ['tetracycline', 'doxycycline', 'doxy', 'minocycline'],
  },
  aminoglycoside: {
    label: 'Aminoglycosides',
    members: ['aminoglycoside', 'gentamicin', 'amikacin', 'streptomycin', 'tobramycin'],
  },
  opioid: {
    label: 'Opioids',
    members: ['opioid', 'opiate', 'morphine', 'codeine', 'tramadol', 'fentanyl', 'pethidine'],
  },
  statin: {
    label: 'Statins',
    members: ['statin', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin'],
  },
  acei: {
    label: 'ACE inhibitors',
    members: [
      'ace inhibitor',
      'ace-inhibitor',
      'acei',
      'enalapril',
      'ramipril',
      'lisinopril',
      'perindopril',
      'captopril',
    ],
  },
  'aromatic-anticonvulsant': {
    label: 'Aromatic anticonvulsants',
    members: [
      'carbamazepine',
      'oxcarbazepine',
      'phenytoin',
      'phenobarbitone',
      'phenobarbital',
      'lamotrigine',
      'primidone',
    ],
  },
  paracetamol: {
    label: 'Paracetamol',
    members: ['paracetamol', 'acetaminophen', 'dolo', 'crocin', 'calpol', 'metacin'],
  },
};

/**
 * Cross-reactivity between DIFFERENT classes. Each entry is deliberate and
 * cited; absence is also deliberate (see the header note on sulfonamides).
 */
const CROSS_REACTIVITY: {
  a: string;
  b: string;
  mechanism: string;
  advice: string;
  source: string;
}[] = [
  {
    a: 'penicillin',
    b: 'cephalosporin',
    mechanism:
      'Shared beta-lactam ring and, for some agents, similar R1 side chains. Cross-reactivity is around 2% overall and lower with 3rd/4th-generation cephalosporins.',
    advice:
      'Avoid if the penicillin reaction was anaphylaxis or another severe immediate reaction. Otherwise a 3rd-generation cephalosporin is usually acceptable — document the decision.',
    source: 'BNF; Ann Intern Med 2019 (beta-lactam cross-reactivity review)',
  },
];

const NO_ALLERGY_PHRASES = [
  'no known',
  'nkda',
  'nka',
  'none',
  'nil',
  'not known',
  'no allergies',
  'denies',
];

/** Word-ish boundary test, so "mox" doesn't match inside "amoxicillin". */
function mentions(haystack: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(haystack);
}

/** The classes a free-text drug string belongs to (usually 0 or 1). */
function classesOf(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const [key, group] of Object.entries(ALLERGEN_CLASSES)) {
    if (group.members.some((m) => mentions(lower, m))) out.push(key);
  }
  return out;
}

/** The specific member tokens a free-text string names. */
function membersOf(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  for (const group of Object.values(ALLERGEN_CLASSES)) {
    for (const m of group.members) if (mentions(lower, m)) out.push(m);
  }
  return out;
}

/** "No known drug allergies" is a recorded fact, not an allergen. */
function isNoAllergy(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (!lower) return true;
  return NO_ALLERGY_PHRASES.some((p) => lower.includes(p));
}

function crossRuleFor(
  drugClasses: string[],
  allergyClasses: string[],
): (typeof CROSS_REACTIVITY)[number] | null {
  for (const rule of CROSS_REACTIVITY) {
    const direct = drugClasses.includes(rule.a) && allergyClasses.includes(rule.b);
    const swapped = drugClasses.includes(rule.b) && allergyClasses.includes(rule.a);
    if (direct || swapped) return rule;
  }
  return null;
}

/**
 * Check a drafted prescription against the patient's recorded allergies.
 * Returns the alerts, `contraindicated` first. An empty result means either
 * "no conflict" or "nothing recognised" — it is NOT a clearance.
 */
export function checkAllergies(drugs: string[], allergies: string[]): AllergyAlert[] {
  const recorded = allergies.filter((a) => a.trim() && !isNoAllergy(a));
  if (recorded.length === 0) return [];

  const out: AllergyAlert[] = [];
  const seen = new Set<string>();
  const push = (alert: AllergyAlert): void => {
    const key = `${alert.drug.toLowerCase()}|${alert.allergy.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(alert);
  };

  for (const drug of drugs) {
    if (!drug.trim()) continue;
    const drugClasses = classesOf(drug);
    const drugMembers = membersOf(drug);
    if (drugClasses.length === 0) continue; // unrecognised — never warn

    for (const allergy of recorded) {
      const allergyClasses = classesOf(allergy);
      const allergyMembers = membersOf(allergy);

      // 1. The exact drug is the recorded allergen.
      const directHit = drugMembers.find((m) => allergyMembers.includes(m));
      if (directHit) {
        push({
          severity: 'contraindicated',
          drug: drug.trim(),
          matched: directHit,
          allergy: allergy.trim(),
          match: 'direct',
          mechanism: 'The patient is recorded as allergic to this exact drug.',
          advice: 'Do not prescribe. Choose an agent from an unrelated class.',
          source: 'Patient allergy record',
        });
        continue;
      }

      // 2. Same allergen class (e.g. amoxicillin against a penicillin allergy).
      const sharedClass = drugClasses.find((c) => allergyClasses.includes(c));
      if (sharedClass) {
        const label = ALLERGEN_CLASSES[sharedClass]?.label ?? sharedClass;
        push({
          severity: 'contraindicated',
          drug: drug.trim(),
          matched: label,
          allergy: allergy.trim(),
          match: 'class',
          mechanism: `This drug belongs to ${label}, the class the patient is recorded as allergic to.`,
          advice: 'Do not prescribe. Choose an agent from an unrelated class.',
          source: 'Patient allergy record; BNF class listing',
        });
        continue;
      }

      // 3. Documented cross-reactivity between two different classes.
      const cross = crossRuleFor(drugClasses, allergyClasses);
      if (cross) {
        const drugLabel = ALLERGEN_CLASSES[drugClasses[0] as string]?.label ?? drugClasses[0]!;
        push({
          severity: 'major',
          drug: drug.trim(),
          matched: drugLabel,
          allergy: allergy.trim(),
          match: 'cross-reactive',
          mechanism: cross.mechanism,
          advice: cross.advice,
          source: cross.source,
        });
      }
    }
  }

  return out.sort((x, y) =>
    x.severity === y.severity ? 0 : x.severity === 'contraindicated' ? -1 : 1,
  );
}

/** One-line rendering for a pad warning / Rail-3 flag. */
export function formatAllergyAlert(a: AllergyAlert): string {
  const sev = a.severity === 'contraindicated' ? 'ALLERGY — DO NOT PRESCRIBE' : 'ALLERGY RISK';
  return `${sev}: ${a.drug} vs recorded allergy "${a.allergy}" — ${a.mechanism} ${a.advice} [${a.source}]`;
}

/**
 * For a list of drug strings, return — aligned to the input order — the
 * formatted allergy-warning lines for each. Mirrors
 * `interactionWarningsByDrug` so a pad row can carry both.
 */
export function allergyWarningsByDrug(drugs: string[], allergies: string[]): string[][] {
  const alerts = checkAllergies(drugs, allergies);
  return drugs.map((d) =>
    alerts.filter((a) => a.drug === d.trim()).map((a) => formatAllergyAlert(a)),
  );
}

/** True when any alert would block a signature (a hard contraindication). */
export function hasBlockingAllergy(alerts: AllergyAlert[]): boolean {
  return alerts.some((a) => a.severity === 'contraindicated');
}
