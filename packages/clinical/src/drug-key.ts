/**
 * Batch B — the one canonical way to identify "which drug is this row".
 *
 * Three places used to key a med row by `drug.split(/\s+/)[0]` — its FIRST
 * WORD. That is wrong twice over for a real prescription:
 *
 *   • Multi-word generics collapse. "Insulin glargine" and "Insulin aspart"
 *     both key to "insulin", so the pad could only ever hold one of them and
 *     confirming either confirmed both.
 *   • It cannot tell a dose CHANGE from a duplicate. "Metformin 500" and
 *     "Metformin 1g" share a key, which is correct for dedup — but only if
 *     the code treats the newer row as superseding, not as a duplicate to
 *     silently drop (see assembleRxPad).
 *
 * The key is the drug NAME: the leading words before the first token that
 * carries a number or looks like a dose/frequency. Everything downstream —
 * the gateway pad assembler, the confirm overlay, the sign-time snapshot —
 * uses this one function so they can never drift apart.
 */

const MOCK_TAG = /^\s*\[mock\]\s*/i;

/** Tokens that end the name and begin the dosing. */
// Anything starting with a digit is dosing ("500", "500mg", "1g", "10U").
// The alphabetic entries are matched WHOLE-word so a real name that merely
// starts with one of them ("Podophyllin", "Sodium valproate") survives.
const DOSE_TOKEN =
  /^(\d.*|od|bd|tds|tid|qid|qds|hs|sos|prn|stat|po|iv|im|sc|tab|cap|syp|inj|susp)$/i;

/**
 * A stable identity key for a med row: lowercase drug name, dosing stripped.
 * "Amoxicillin 500mg TDS x 5 days" → "amoxicillin".
 * "Insulin glargine 10U HS"        → "insulin glargine".
 * Falls back to the whole cleaned string when nothing looks like a name.
 */
export function drugNameKey(drug: string): string {
  const cleaned = drug.replace(MOCK_TAG, '').trim().toLowerCase();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/);
  const name: string[] = [];
  for (const word of words) {
    const bare = word.replace(/[(),;]/g, '');
    if (!bare) continue;
    if (DOSE_TOKEN.test(bare)) break;
    name.push(bare);
    // A generic is at most two words in practice ("insulin glargine",
    // "co-amoxiclav"); past that we are reading the instructions.
    if (name.length === 2) break;
  }
  return name.length > 0 ? name.join(' ') : cleaned;
}

/** True when two med rows refer to the same drug (regardless of dose). */
export function sameDrug(a: string, b: string): boolean {
  const ka = drugNameKey(a);
  return ka !== '' && ka === drugNameKey(b);
}
