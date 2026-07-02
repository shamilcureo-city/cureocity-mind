/**
 * Sprint DS8 — word-error-rate primitives for the ASR benchmark.
 *
 * Two metrics matter for the doctor scribe:
 *   - overall WER (transcript quality), and
 *   - term error rate for the safety-critical vocabulary (drug names,
 *     key clinical terms) — a drug name mangled in a code-mix consult is
 *     a patient-safety problem, not a cosmetic one.
 *
 * Text is normalised (lowercased, NFC, punctuation stripped) before
 * scoring so casing / punctuation never inflate the numbers. Real Indian
 * consults code-mix (Hinglish / Manglish) with the clinical keywords in
 * English — the reference transcripts keep that mix, and the term metrics
 * score only the English clinical terms that must survive.
 */

/** Normalise + tokenise a transcript for comparison. */
export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:()"'“”‘’…]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Token-level Levenshtein edit distance (substitutions + indels). */
export function editDistance(ref: string[], hyp: string[]): number {
  const n = ref.length;
  const m = hyp.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    curr[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + cost, // substitution / match
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m]!;
}

export interface WerResult {
  wer: number;
  errors: number;
  refWords: number;
}

/** Overall word error rate of `hyp` against `ref`. */
export function wordErrorRate(ref: string, hyp: string): WerResult {
  const r = tokenize(ref);
  const h = tokenize(hyp);
  const errors = editDistance(r, h);
  const wer = r.length ? errors / r.length : h.length ? 1 : 0;
  return { wer, errors, refWords: r.length };
}

/** How many times `term` (1..k words) occurs as a token subsequence in `tokens`. */
function countOccurrences(tokens: string[], term: string[]): number {
  if (term.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + term.length <= tokens.length; i++) {
    let hit = true;
    for (let j = 0; j < term.length; j++) {
      if (tokens[i + j] !== term[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      count++;
      i += term.length - 1;
    }
  }
  return count;
}

export interface TermErrorResult {
  ter: number;
  total: number;
  missed: number;
  perTerm: { term: string; refCount: number; missed: number }[];
}

/**
 * Term error rate: of every reference occurrence of a safety-critical
 * term, how many failed to appear (verbatim) in the hypothesis. A missed
 * occurrence is a substitution or deletion of that term — exactly the
 * failure that matters for drug names. Insertions of a term the reference
 * never had are ignored (that's a different, less dangerous, error).
 */
export function termErrorRate(ref: string, hyp: string, terms: string[]): TermErrorResult {
  const refTokens = tokenize(ref);
  const hypTokens = tokenize(hyp);
  const perTerm: { term: string; refCount: number; missed: number }[] = [];
  let total = 0;
  let missed = 0;
  for (const raw of terms) {
    const term = tokenize(raw);
    const refCount = countOccurrences(refTokens, term);
    if (refCount === 0) continue; // term not in this reference — skip
    const hypCount = countOccurrences(hypTokens, term);
    const miss = Math.max(0, refCount - hypCount);
    perTerm.push({ term: raw, refCount, missed: miss });
    total += refCount;
    missed += miss;
  }
  return { ter: total ? missed / total : 0, total, missed, perTerm };
}
