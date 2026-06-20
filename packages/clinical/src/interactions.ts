/**
 * Sprint DV5 — deterministic drug–drug interaction checker.
 *
 * The doctor analogue of the crisis-hotline / reliable-change engines:
 * rule-based, citation-bearing, no external API and no LLM. A curated set
 * of clinically significant interactions an Indian OPD prescriber meets
 * daily. This is intentionally conservative — it flags the well-known
 * dangerous pairs; it is NOT an exhaustive formulary. The richer,
 * patient-context-aware reasoning is the differential pass (DV6).
 *
 * DO NOT loosen a `contraindicated`/`major` severity without a pharmacology
 * citation — these gate a 💊 safety flag in front of the prescriber.
 */

export type InteractionSeverity = 'contraindicated' | 'major' | 'moderate' | 'minor';

export interface DrugInteraction {
  severity: InteractionSeverity;
  /** Canonical generic names of the two interacting drugs, sorted. */
  drugA: string;
  drugB: string;
  /** The pharmacological mechanism / consequence, one line. */
  mechanism: string;
  /** What the prescriber should do. */
  advice: string;
  /** Reference for the rule (a recognised formulary / guideline). */
  source: string;
}

/** A normalised drug: its canonical generic name + therapeutic class. */
interface KnownDrug {
  generic: string;
  classes: string[];
}

// A compact dictionary mapping the tokens we recognise (generics + a few
// common Indian brand names) to a canonical generic + its classes. Keys
// are lowercase; matching is substring-on-token so "Atorvastatin 40mg"
// resolves to atorvastatin → statin.
const DRUG_DICTIONARY: Record<string, KnownDrug> = {
  // Anticoagulant
  warfarin: { generic: 'Warfarin', classes: ['anticoagulant'] },
  acitrom: { generic: 'Acenocoumarol', classes: ['anticoagulant'] },
  acenocoumarol: { generic: 'Acenocoumarol', classes: ['anticoagulant'] },
  // Antiplatelets
  aspirin: { generic: 'Aspirin', classes: ['nsaid', 'antiplatelet'] },
  ecosprin: { generic: 'Aspirin', classes: ['nsaid', 'antiplatelet'] },
  clopidogrel: { generic: 'Clopidogrel', classes: ['antiplatelet'] },
  // NSAIDs
  ibuprofen: { generic: 'Ibuprofen', classes: ['nsaid'] },
  brufen: { generic: 'Ibuprofen', classes: ['nsaid'] },
  diclofenac: { generic: 'Diclofenac', classes: ['nsaid'] },
  naproxen: { generic: 'Naproxen', classes: ['nsaid'] },
  // ACE inhibitors / ARBs
  enalapril: { generic: 'Enalapril', classes: ['acei', 'raas'] },
  ramipril: { generic: 'Ramipril', classes: ['acei', 'raas'] },
  lisinopril: { generic: 'Lisinopril', classes: ['acei', 'raas'] },
  telmisartan: { generic: 'Telmisartan', classes: ['arb', 'raas'] },
  losartan: { generic: 'Losartan', classes: ['arb', 'raas'] },
  // Potassium-sparing diuretics / supplements
  spironolactone: { generic: 'Spironolactone', classes: ['potassium-sparing'] },
  // Statins
  simvastatin: { generic: 'Simvastatin', classes: ['statin'] },
  atorvastatin: { generic: 'Atorvastatin', classes: ['statin'] },
  rosuvastatin: { generic: 'Rosuvastatin', classes: ['statin'] },
  // Macrolides (CYP3A4 inhibitors)
  clarithromycin: { generic: 'Clarithromycin', classes: ['macrolide', 'cyp3a4-inhibitor'] },
  erythromycin: { generic: 'Erythromycin', classes: ['macrolide', 'cyp3a4-inhibitor'] },
  // SSRIs + serotonergic
  fluoxetine: { generic: 'Fluoxetine', classes: ['ssri', 'serotonergic'] },
  sertraline: { generic: 'Sertraline', classes: ['ssri', 'serotonergic'] },
  escitalopram: { generic: 'Escitalopram', classes: ['ssri', 'serotonergic'] },
  tramadol: { generic: 'Tramadol', classes: ['opioid', 'serotonergic'] },
  // Cardiac
  digoxin: { generic: 'Digoxin', classes: ['digoxin'] },
  amiodarone: { generic: 'Amiodarone', classes: ['antiarrhythmic'] },
  // PDE5 inhibitors + nitrates
  sildenafil: { generic: 'Sildenafil', classes: ['pde5-inhibitor'] },
  nitroglycerin: { generic: 'Nitroglycerin', classes: ['nitrate'] },
  isosorbide: { generic: 'Isosorbide', classes: ['nitrate'] },
  // PPI
  omeprazole: { generic: 'Omeprazole', classes: ['ppi', 'cyp2c19-inhibitor'] },
  // Antidiabetic / other (for context — no rule yet)
  metformin: { generic: 'Metformin', classes: ['biguanide'] },
  methotrexate: { generic: 'Methotrexate', classes: ['dmard'] },
};

interface ClassRule {
  classA: string;
  classB: string;
  severity: InteractionSeverity;
  mechanism: string;
  advice: string;
  source: string;
}

// Class-pair rules. Two drugs interact if one matches classA and the
// other classB (in either order). Same-class self-pairs (e.g. two
// serotonergics) are matched when classA === classB.
const CLASS_RULES: ClassRule[] = [
  {
    classA: 'anticoagulant',
    classB: 'nsaid',
    severity: 'major',
    mechanism: 'Additive bleeding risk; NSAIDs also displace warfarin and irritate GI mucosa.',
    advice: 'Avoid the combination; if unavoidable, gastroprotect and monitor INR closely.',
    source: 'BNF / Stockley’s Drug Interactions',
  },
  {
    classA: 'anticoagulant',
    classB: 'antiplatelet',
    severity: 'major',
    mechanism: 'Additive bleeding risk from combined anticoagulant + antiplatelet effect.',
    advice: 'Co-prescribe only with a clear indication; counsel on bleeding and monitor.',
    source: 'BNF / Stockley’s Drug Interactions',
  },
  {
    classA: 'acei',
    classB: 'potassium-sparing',
    severity: 'major',
    mechanism: 'Both raise serum potassium — risk of dangerous hyperkalaemia.',
    advice: 'Monitor serum potassium and renal function; avoid in renal impairment.',
    source: 'BNF (RAAS + potassium-sparing diuretic)',
  },
  {
    classA: 'arb',
    classB: 'potassium-sparing',
    severity: 'major',
    mechanism: 'Both raise serum potassium — risk of dangerous hyperkalaemia.',
    advice: 'Monitor serum potassium and renal function; avoid in renal impairment.',
    source: 'BNF (RAAS + potassium-sparing diuretic)',
  },
  {
    classA: 'statin',
    classB: 'cyp3a4-inhibitor',
    severity: 'major',
    mechanism: 'CYP3A4 inhibition raises statin levels — risk of myopathy / rhabdomyolysis.',
    advice: 'Avoid with simvastatin/atorvastatin; pause the statin or use a non-CYP3A4 statin.',
    source: 'BNF (statin + macrolide)',
  },
  {
    classA: 'serotonergic',
    classB: 'serotonergic',
    severity: 'major',
    mechanism: 'Additive serotonergic effect — risk of serotonin syndrome.',
    advice: 'Avoid combining; if used, counsel on serotonin-syndrome features and monitor.',
    source: 'BNF (serotonergic combinations)',
  },
  {
    classA: 'digoxin',
    classB: 'antiarrhythmic',
    severity: 'major',
    mechanism: 'Amiodarone raises plasma digoxin — risk of digoxin toxicity.',
    advice: 'Halve the digoxin dose and monitor levels + ECG.',
    source: 'BNF (digoxin + amiodarone)',
  },
  {
    classA: 'nitrate',
    classB: 'pde5-inhibitor',
    severity: 'contraindicated',
    mechanism: 'Profound additive vasodilation — risk of severe, life-threatening hypotension.',
    advice: 'Contraindicated. Do not co-prescribe; separate by the drug’s washout period.',
    source: 'BNF (nitrate + PDE5 inhibitor — contraindicated)',
  },
  {
    classA: 'antiplatelet',
    classB: 'cyp2c19-inhibitor',
    severity: 'moderate',
    mechanism: 'Omeprazole inhibits CYP2C19, reducing activation of clopidogrel.',
    advice: 'Prefer pantoprazole if a PPI is needed alongside clopidogrel.',
    source: 'BNF (clopidogrel + omeprazole)',
  },
  {
    classA: 'dmard',
    classB: 'nsaid',
    severity: 'major',
    mechanism: 'NSAIDs reduce methotrexate clearance — risk of methotrexate toxicity.',
    advice: 'Avoid NSAIDs with methotrexate; monitor FBC and renal function.',
    source: 'BNF (methotrexate + NSAID)',
  },
];

const SEVERITY_RANK: Record<InteractionSeverity, number> = {
  contraindicated: 0,
  major: 1,
  moderate: 2,
  minor: 3,
};

/** Resolve a free-text drug string to a known drug, or null. */
function resolveDrug(raw: string): KnownDrug | null {
  const text = raw.toLowerCase();
  for (const [token, drug] of Object.entries(DRUG_DICTIONARY)) {
    // word-ish boundary match so "naproxen" doesn't match inside another word
    const re = new RegExp(`(^|[^a-z])${token}([^a-z]|$)`);
    if (re.test(text)) return drug;
  }
  return null;
}

function classRuleFor(a: KnownDrug, b: KnownDrug): ClassRule | null {
  let best: ClassRule | null = null;
  for (const rule of CLASS_RULES) {
    const direct = a.classes.includes(rule.classA) && b.classes.includes(rule.classB);
    const swapped = a.classes.includes(rule.classB) && b.classes.includes(rule.classA);
    if (!direct && !swapped) continue;
    if (!best || SEVERITY_RANK[rule.severity] < SEVERITY_RANK[best.severity]) best = rule;
  }
  return best;
}

/**
 * Check a list of drug strings (the drafted Rx) for pairwise interactions.
 * Returns one DrugInteraction per interacting pair, most-severe first.
 * Unrecognised drugs are silently skipped (we never warn on what we
 * can't reason about) — the prescriber stays responsible for the rest.
 */
export function checkInteractions(drugs: string[]): DrugInteraction[] {
  const resolved = drugs.map((d) => resolveDrug(d)).filter((d): d is KnownDrug => d !== null);

  const out: DrugInteraction[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i]!;
      const b = resolved[j]!;
      if (a.generic === b.generic) continue;
      const rule = classRuleFor(a, b);
      if (!rule) continue;
      const [drugA, drugB] = [a.generic, b.generic].sort();
      const key = `${drugA}|${drugB}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        severity: rule.severity,
        drugA,
        drugB,
        mechanism: rule.mechanism,
        advice: rule.advice,
        source: rule.source,
      });
    }
  }
  return out.sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

/** One-line, human-readable rendering for a warning string / Rail-3 flag. */
export function formatInteraction(i: DrugInteraction): string {
  const sev = i.severity === 'contraindicated' ? 'CONTRAINDICATED' : i.severity.toUpperCase();
  return `${sev}: ${i.drugA} + ${i.drugB} — ${i.mechanism} ${i.advice} [${i.source}]`;
}

/**
 * For a list of drug strings, return — aligned to the input order — the
 * formatted interaction-warning lines each drug participates in. Used to
 * stamp `MedicationOrderV1.interactionWarnings` per order. Unrecognised
 * drugs get an empty array.
 */
export function interactionWarningsByDrug(drugs: string[]): string[][] {
  const resolved = drugs.map((d) => resolveDrug(d));
  const out: string[][] = drugs.map(() => []);
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i];
      const b = resolved[j];
      if (!a || !b || a.generic === b.generic) continue;
      const rule = classRuleFor(a, b);
      if (!rule) continue;
      const [drugA, drugB] = [a.generic, b.generic].sort();
      const line = formatInteraction({
        severity: rule.severity,
        drugA,
        drugB,
        mechanism: rule.mechanism,
        advice: rule.advice,
        source: rule.source,
      });
      if (!out[i]!.includes(line)) out[i]!.push(line);
      if (!out[j]!.includes(line)) out[j]!.push(line);
    }
  }
  return out;
}
