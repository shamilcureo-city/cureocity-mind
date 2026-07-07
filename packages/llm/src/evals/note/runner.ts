import type { IPass2Backend } from '../../types';
import { NOTE_FIXTURES, type NoteFixture } from './fixtures';
import { aggregate, scoreFixture, type NoteEvalReport } from './scorer';

/**
 * Sprint 76 — run the golden SOAP-note set through a Pass 2 backend and score
 * it. One note per fixture on the full transcript (the eval measures note
 * quality given the whole session; incremental behaviour is the gateway's
 * concern).
 */
export async function runNoteEval(
  backend: IPass2Backend,
  fixtures: NoteFixture[] = NOTE_FIXTURES,
): Promise<NoteEvalReport> {
  const scores = [];
  for (const fixture of fixtures) {
    const { output } = await backend.run({
      sessionId: `eval-${fixture.id}`,
      transcript: fixture.segments.map((s) => `[${s.speaker}] ${s.text}`).join('\n'),
      speakerSegments: fixture.segments,
      kind: 'TREATMENT',
      modality: fixture.modality,
      vertical: 'THERAPIST',
      clientContext: { presentingConcerns: fixture.presentingConcerns },
    });
    scores.push(scoreFixture(fixture, output));
  }
  return aggregate(scores);
}

/**
 * The quality gate: every fixture must capture its expected risk (safety is
 * non-negotiable) AND mean fact recall must clear 0.6. A candidate Pass 2
 * model only ships if it clears this on the vertex backend.
 */
export function passesGate(report: NoteEvalReport): boolean {
  return report.riskHits === report.total && report.meanFactRecall >= 0.6;
}

export function formatReport(report: NoteEvalReport, backend: string): string {
  const lines: string[] = [];
  lines.push(`Note eval — backend=${backend} — ${report.total} sessions`);
  lines.push('');
  for (const s of report.scores) {
    const risk = s.riskHit ? '✓' : '✗ UNDER-FLAGGED';
    lines.push(
      `  ${s.id.padEnd(24)} [${s.language}] risk=${s.capturedRisk} ${risk}  ` +
        `factRecall=${s.factRecall.toFixed(2)} sections=${s.sectionsComplete ? 'ok' : 'INCOMPLETE'}` +
        (s.missedFacts.length ? `  missed: ${s.missedFacts.join(', ')}` : ''),
    );
  }
  lines.push('');
  lines.push(
    `Risk captured: ${report.riskHits}/${report.total} ` +
      `(${(report.riskHitRate * 100).toFixed(0)}%)  ·  ` +
      `mean fact recall ${report.meanFactRecall.toFixed(2)}  ·  ` +
      `all sections complete: ${report.sectionsCompleteAll ? 'yes' : 'NO'}`,
  );
  return lines.join('\n');
}
