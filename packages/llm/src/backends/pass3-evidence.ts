/**
 * Pass 3 (Clinical Analysis) — transcript evidence gate (Sprint TS0).
 *
 * The therapist analogue of the doctor live citation gate
 * (`services/live-gateway/src/case-state.ts`). The Pass-3 prompt demands
 * every diagnosis candidate cite VERBATIM supporting quotes, but nothing
 * verified them — a hallucinated quote passed straight through to the
 * client's permanent `ClientDiagnosis.supportingEvidence` record.
 *
 * `verifyPass3Evidence()` runs on the RAW (pre-Zod) normalised object and
 * checks each supporting quote against the actual transcript:
 *   - `diagnosisCandidates[]` / `differential[]`: unverifiable quotes are
 *     dropped; a candidate that loses ALL its evidence is dropped
 *     (`supportingEvidence` is `min(1)`), and `primaryDiagnosisIndex` is
 *     remapped/nulled so it never dangles.
 *   - `crisisFlags[].indicators`: unverifiable quotes are stripped, but the
 *     flag is NEVER dropped and never emptied below its original set —
 *     safety first: we never hide a crisis for lack of a clean citation.
 *
 * Matching is lenient about punctuation/case/whitespace but strict about
 * words: a quote passes if its normalised text is contained in the
 * normalised transcript, or if a ≥80% contiguous word-shingle of it is. A
 * fabricated quote fails; minor transcription drift passes. Idempotent;
 * returns a new object (the input is not mutated).
 */

function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True if `quote` is (verbatim-ish) present in the transcript `haystack`.
 * Both sides are normalised (lowercase, punctuation→space, collapsed
 * whitespace) so a caller can pass a raw or pre-normalised haystack —
 * re-normalising an already-normalised string is idempotent.
 */
export function quoteVerified(quote: unknown, haystack: string): boolean {
  if (typeof quote !== 'string') return false;
  const q = normText(quote);
  if (!q) return false;
  const h = normText(haystack);
  if (h.includes(q)) return true;
  const words = q.split(' ');
  // Short quotes must match verbatim — a 3-word phrase is too easy to
  // false-positive on common words.
  if (words.length <= 4) return false;
  const need = Math.ceil(words.length * 0.8);
  for (let i = 0; i + need <= words.length; i++) {
    if (h.includes(words.slice(i, i + need).join(' '))) return true;
  }
  return false;
}

export interface EvidenceGateStats {
  candidatesChecked: number;
  quotesChecked: number;
  quotesDropped: number;
  candidatesDropped: number;
}

/**
 * Filter a candidate array's `supportingEvidence` against the transcript,
 * dropping candidates left with no verified evidence. Returns the kept
 * candidates plus an old→new index map (`-1` = dropped) so callers can
 * remap a positional index like `primaryDiagnosisIndex`.
 */
function verifyCandidates(
  arr: unknown,
  haystack: string,
  stats: EvidenceGateStats,
): { kept: unknown[]; indexMap: number[] } {
  const kept: unknown[] = [];
  const indexMap: number[] = [];
  if (!Array.isArray(arr)) return { kept: [], indexMap };
  for (const cand of arr) {
    if (!cand || typeof cand !== 'object') {
      indexMap.push(kept.length);
      kept.push(cand);
      continue;
    }
    const c = cand as Record<string, unknown>;
    const ev = c['supportingEvidence'];
    if (!Array.isArray(ev)) {
      indexMap.push(kept.length);
      kept.push(cand);
      continue;
    }
    stats.candidatesChecked++;
    const verified = ev.filter((e) => {
      stats.quotesChecked++;
      const ok =
        !!e &&
        typeof e === 'object' &&
        quoteVerified((e as Record<string, unknown>)['quote'], haystack);
      if (!ok) stats.quotesDropped++;
      return ok;
    });
    if (verified.length === 0) {
      stats.candidatesDropped++;
      indexMap.push(-1); // dropped
      continue;
    }
    indexMap.push(kept.length);
    kept.push({ ...c, supportingEvidence: verified });
  }
  return { kept, indexMap };
}

/** Strip unverified indicator quotes from crisis flags, but never empty/drop a flag (safety). */
function verifyCrisisFlags(arr: unknown, haystack: string): unknown {
  if (!Array.isArray(arr)) return arr;
  return arr.map((flag) => {
    if (!flag || typeof flag !== 'object') return flag;
    const f = flag as Record<string, unknown>;
    const ind = f['indicators'];
    if (!Array.isArray(ind) || ind.length === 0) return flag;
    const verified = ind.filter(
      (e) =>
        !!e &&
        typeof e === 'object' &&
        quoteVerified((e as Record<string, unknown>)['quote'], haystack),
    );
    // Never hide a crisis for lack of a clean citation: keep the original
    // indicators if verification would empty them (schema min is 1).
    if (verified.length === 0) return flag;
    return { ...f, indicators: verified };
  });
}

/**
 * Verify a raw (normalised, pre-Zod) Pass-3 object — a ClinicalReportV1 or
 * an InitialAssessmentBriefV1 body — against its session transcript.
 */
export function verifyPass3Evidence(
  raw: unknown,
  transcript: string,
): { output: unknown; stats: EvidenceGateStats } {
  const stats: EvidenceGateStats = {
    candidatesChecked: 0,
    quotesChecked: 0,
    quotesDropped: 0,
    candidatesDropped: 0,
  };
  if (!raw || typeof raw !== 'object') return { output: raw, stats };
  const haystack = normText(transcript);
  // No transcript to check against → pass through unchanged (don't nuke a
  // report just because the caller didn't supply the transcript).
  if (!haystack) return { output: raw, stats };
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...r };

  if ('diagnosisCandidates' in r) {
    const { kept, indexMap } = verifyCandidates(r['diagnosisCandidates'], haystack, stats);
    out['diagnosisCandidates'] = kept;
    const pdi = r['primaryDiagnosisIndex'];
    if (typeof pdi === 'number' && Number.isInteger(pdi)) {
      out['primaryDiagnosisIndex'] =
        pdi >= 0 && pdi < indexMap.length && indexMap[pdi] >= 0 ? indexMap[pdi] : null;
    }
  }
  if ('differential' in r) {
    out['differential'] = verifyCandidates(r['differential'], haystack, stats).kept;
  }
  if ('crisisFlags' in r) {
    out['crisisFlags'] = verifyCrisisFlags(r['crisisFlags'], haystack);
  }
  return { output: out, stats };
}
