import type { CaseState } from '@cureocity/contracts';
import type { IPassReasoningBackend } from '../../types';
import { REASONING_FIXTURES, type ReasoningFixture } from './fixtures';
import { aggregate, scoreFixture, type EvalReport, type FixtureScore } from './scorer';

/**
 * Sprint DS2 — run the golden reasoning set through a PassReasoning backend
 * and score it. One-shot per fixture (all utterances as the new batch, empty
 * starting CaseState) — the eval measures differential quality given the full
 * transcript; the gateway's incremental behaviour is covered by its own
 * integration test.
 */
export async function runReasoningEval(
  backend: IPassReasoningBackend,
  fixtures: ReasoningFixture[] = REASONING_FIXTURES,
): Promise<EvalReport> {
  const scores: FixtureScore[] = [];
  for (const fixture of fixtures) {
    const caseState: CaseState = {
      patient: fixture.patient,
      findings: [],
      answeredQuestionIds: [],
      version: 0,
    };
    const { output } = await backend.run({
      sessionId: `eval-${fixture.id}`,
      caseState,
      previousDifferential: [],
      newUtterances: fixture.utterances,
      ...(fixture.specialty ? { specialty: fixture.specialty } : {}),
      language: fixture.language,
    });
    scores.push(scoreFixture(fixture, output));
  }
  return aggregate(scores);
}

/** Human-readable report for the CLI. */
export function formatReport(report: EvalReport, backend: string): string {
  const lines: string[] = [];
  lines.push(`Reasoning eval — backend=${backend} — ${report.total} consults`);
  lines.push('');
  for (const s of report.scores) {
    const mark = s.primaryHit ? '✓' : '✗';
    lines.push(
      `  ${mark} ${s.id.padEnd(12)} [${s.domain}/${s.language}] ` +
        `top3Recall=${s.top3Recall.toFixed(2)} ask=${s.askRecall.toFixed(2)} ` +
        `dropped=${s.droppedDx} — ${s.topLabels.join(', ') || '(none)'}`,
    );
  }
  lines.push('');
  lines.push(
    `Primary-in-top3: ${report.primaryHits}/${report.total} ` +
      `(${(report.primaryHitRate * 100).toFixed(0)}%)  ·  ` +
      `mean top3 recall ${report.meanTop3Recall.toFixed(2)}  ·  ` +
      `mean ask recall ${report.meanAskRecall.toFixed(2)}  ·  ` +
      `dropped dx ${report.totalDroppedDx}  ·  ` +
      `all rendered cited: ${report.allRenderedCited ? 'yes' : 'NO'}`,
  );
  return lines.join('\n');
}

/** The DS2 acceptance gate: expected dx in top-3 for ≥10/12 consults. */
export function passesGate(report: EvalReport): boolean {
  const required = Math.ceil((report.total * 10) / 12);
  return report.primaryHits >= required && report.allRenderedCited;
}
