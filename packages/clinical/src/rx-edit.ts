import type { RxPadV1 } from '@cureocity/contracts';

/**
 * Sprint DS5-fu — the deterministic "Rx ≤1-edit" diff behind the pilot
 * metric (DS9 left it null). It compares the AI-DRAFTED pad (NoteDraft.rxPad,
 * the live-consult assembly) against the SIGNED pad (TherapyNote.rxPad,
 * confirmed meds only) and counts the doctor's edits to the medication list:
 *   - a drug the doctor declined (in drafted, gone from signed) = 1 edit,
 *   - a drug added at sign time (in signed, not drafted)        = 1 edit,
 *   - a dose/frequency change on a kept drug                    = 1 edit.
 * Continued meds appear on both sides unchanged and cost nothing. status /
 * warnings / route / timing are intentionally NOT diffed — confirming a
 * pending suggestion keeps the row (0 edits); the clinical decision is the
 * drug + its dose + frequency.
 *
 * Pure + deterministic so it can be unit-tested here and reused by the
 * insights rollup.
 */
type RxMed = RxPadV1['meds'][number];

function norm(s?: string): string {
  return (s ?? '')
    .replace(/\[mock\]/gi, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

interface NormMed {
  drug: string;
  /** strength + dose collapsed — the "how much" of the prescription. */
  dose: string;
  freq: string;
}

function normMeds(meds?: RxMed[]): NormMed[] {
  return (meds ?? [])
    .map((m) => ({
      drug: norm(m.drug),
      dose: norm([m.strength, m.dose].filter(Boolean).join(' ')),
      freq: norm(m.frequency),
    }))
    .filter((m) => m.drug !== '');
}

function groupByDrug(meds: NormMed[]): Map<string, NormMed[]> {
  const g = new Map<string, NormMed[]>();
  for (const m of meds) {
    const rows = g.get(m.drug) ?? [];
    rows.push(m);
    g.set(m.drug, rows);
  }
  return g;
}

/** How many edits the doctor made to the drafted med list to reach the signed one. */
export function rxEditCount(drafted?: RxMed[], signed?: RxMed[]): number {
  const d = groupByDrug(normMeds(drafted));
  const s = groupByDrug(normMeds(signed));
  let edits = 0;
  for (const drug of new Set([...d.keys(), ...s.keys()])) {
    const dl = d.get(drug) ?? [];
    const sl = s.get(drug) ?? [];
    // rows added/removed for this drug
    edits += Math.abs(dl.length - sl.length);
    // dose/freq changes across the rows that exist on both sides
    const dk = dl.map((x) => `${x.dose}|${x.freq}`).sort();
    const sk = sl.map((x) => `${x.dose}|${x.freq}`).sort();
    const paired = Math.min(dk.length, sk.length);
    for (let i = 0; i < paired; i++) {
      if (dk[i] !== sk[i]) edits++;
    }
  }
  return edits;
}

export function rxWithinOneEdit(drafted?: RxMed[], signed?: RxMed[]): boolean {
  return rxEditCount(drafted, signed) <= 1;
}
