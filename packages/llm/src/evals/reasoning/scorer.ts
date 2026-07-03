import type { AskNextItem, ClinicalFinding, LiveDifferentialItem } from '@cureocity/contracts';
import type { PassReasoningOutput } from '../../types';
import type { ReasoningFixture } from './fixtures';

/**
 * Sprint DS2 — scorer for the reasoning eval. Applies the same citation gate
 * the gateway applies (drop dx that cite no real finding), then measures:
 *   - primaryHit: the fixture's primary expected dx is in the top-3.
 *   - top3Recall: fraction of expected dx found among the top-3.
 *   - askRecall:  fraction of expected must-ask keywords found in ask-next.
 *   - droppedDx:  how many candidates the model produced that were uncited
 *     (these NEVER render — this is the hallucination-control metric).
 */
export interface FixtureScore {
  id: string;
  domain: ReasoningFixture['domain'];
  language: ReasoningFixture['language'];
  primaryHit: boolean;
  top3Recall: number;
  askRecall: number;
  /** Candidates dropped by the citation gate (0 is ideal). */
  droppedDx: number;
  /** Post-gate invariant: every rendered dx cites a real finding. */
  renderedAllCited: boolean;
  topLabels: string[];
}

/** The gateway's differential citation gate, reproduced for the eval. */
export function gateDifferential(
  differential: LiveDifferentialItem[],
  findings: ClinicalFinding[],
): { kept: LiveDifferentialItem[]; dropped: number } {
  const known = new Set(findings.map((f) => f.id));
  const kept: LiveDifferentialItem[] = [];
  let dropped = 0;
  for (const d of differential) {
    if (d.evidenceFor.some((id) => known.has(id))) kept.push(d);
    else dropped++;
  }
  return { kept: kept.slice(0, 5), dropped };
}

function includesKeyword(haystack: string, keyword: string): boolean {
  return haystack.toLowerCase().includes(keyword.toLowerCase());
}

export function scoreFixture(fixture: ReasoningFixture, output: PassReasoningOutput): FixtureScore {
  const { kept, dropped } = gateDifferential(output.differential, output.findings);
  const known = new Set(output.findings.map((f) => f.id));

  const top3 = kept.slice(0, 3);
  const top3Blob = top3.map((d) => d.label).join(' | ');
  const matchedTop = fixture.expectTop3.filter((kw) => includesKeyword(top3Blob, kw));
  const primaryHit =
    fixture.expectTop3.length > 0 && includesKeyword(top3Blob, fixture.expectTop3[0]!);

  const askBlob = (output.askNext as AskNextItem[]).map((a) => a.question).join(' | ');
  const matchedAsk = fixture.expectAsk.filter((kw) => includesKeyword(askBlob, kw));

  return {
    id: fixture.id,
    domain: fixture.domain,
    language: fixture.language,
    primaryHit,
    top3Recall: fixture.expectTop3.length ? matchedTop.length / fixture.expectTop3.length : 1,
    askRecall: fixture.expectAsk.length ? matchedAsk.length / fixture.expectAsk.length : 1,
    droppedDx: dropped,
    renderedAllCited: kept.every((d) => d.evidenceFor.some((id) => known.has(id))),
    topLabels: top3.map((d) => d.label),
  };
}

export interface EvalReport {
  total: number;
  primaryHits: number;
  primaryHitRate: number;
  meanTop3Recall: number;
  meanAskRecall: number;
  totalDroppedDx: number;
  allRenderedCited: boolean;
  scores: FixtureScore[];
}

export function aggregate(scores: FixtureScore[]): EvalReport {
  const total = scores.length;
  const primaryHits = scores.filter((s) => s.primaryHit).length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    total,
    primaryHits,
    primaryHitRate: total ? primaryHits / total : 0,
    meanTop3Recall: mean(scores.map((s) => s.top3Recall)),
    meanAskRecall: mean(scores.map((s) => s.askRecall)),
    totalDroppedDx: scores.reduce((n, s) => n + s.droppedDx, 0),
    allRenderedCited: scores.every((s) => s.renderedAllCited),
    scores,
  };
}
