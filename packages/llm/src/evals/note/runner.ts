import type { IPass2Backend, Pass2Input } from '../../types';
import { containsTranscriptionArtifact } from '@cureocity/contracts';
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
  source:
    | { kind: 'reference' }
    | {
        kind: 'asr';
        /** Explicit output per fixture; no missing-ASR fallback to golden text. */
        transcripts: ReadonlyMap<string, Pick<Pass2Input, 'transcript' | 'speakerSegments'>>;
      } = { kind: 'reference' },
): Promise<NoteEvalReport> {
  const scores = [];
  const prepared = fixtures.map((fixture) => {
    const transcriptInput =
      source.kind === 'reference'
        ? {
            transcript: fixture.segments.map((s) => `[${s.speaker}] ${s.text}`).join('\n'),
            speakerSegments: fixture.segments,
          }
        : source.transcripts.get(fixture.id);
    if (!transcriptInput) throw new Error('ASR_NOTE_SOURCE_UNAVAILABLE');
    if (
      !transcriptInput.transcript.trim() ||
      containsTranscriptionArtifact(transcriptInput.transcript) ||
      transcriptInput.speakerSegments.some((s) => containsTranscriptionArtifact(s.text))
    ) {
      throw new Error('NOTE_SOURCE_UNAVAILABLE');
    }
    return { fixture, transcriptInput };
  });
  for (const { fixture, transcriptInput } of prepared) {
    const { output } = await backend.run({
      sessionId: `eval-${fixture.id}`,
      ...transcriptInput,
      kind: fixture.kind ?? 'TREATMENT',
      modality: fixture.modality,
      vertical: 'THERAPIST',
      clientContext: { presentingConcerns: fixture.presentingConcerns },
    });
    scores.push(scoreFixture(fixture, output));
  }
  return { ...aggregate(scores), source: source.kind };
}

/**
 * The quality gate: every fixture must capture its expected risk (safety is
 * non-negotiable), sections must be complete and literal-regression checks
 * must pass. The old 0.6 keyword threshold stays a synthetic regression
 * bound, NOT the proposed human-annotated 95% precision / 90% recall gate.
 * This function never establishes clinical validation or permits a release.
 */
export function passesGate(report: NoteEvalReport): boolean {
  return (
    report.evaluable &&
    report.total > 0 &&
    report.scores.length === report.total &&
    report.riskHits === report.total &&
    report.riskFalsePositives === 0 &&
    report.riskFalseNegatives === 0 &&
    report.criticalOmissions === 0 &&
    report.forbiddenClaimHits === 0 &&
    report.sectionsCompleteAll &&
    report.scores.every((s) => !s.artifact && s.kindMatches) &&
    report.meanFactRecall >= 0.6
  );
}

export function formatReport(report: NoteEvalReport, backend: string): string {
  const lines: string[] = [];
  lines.push(
    `Note eval — backend=${backend} — source=${report.source ?? 'unspecified'} — ${report.total} sessions`,
  );
  lines.push('');
  for (const s of report.scores) {
    const risk = s.riskFalseNegative
      ? 'UNDER-FLAGGED'
      : s.riskFalsePositive
        ? 'OVER-FLAGGED'
        : 'MATCH';
    lines.push(
      `  ${s.id.padEnd(24)} [${s.language}] risk=${s.capturedRisk} ${risk}  ` +
        `factRecall=${s.factRecall.toFixed(2)} sections=${s.sectionsComplete ? 'ok' : 'INCOMPLETE'}` +
        ` missingFacts=${s.missedFacts.length} criticalOmissions=${s.criticalOmissions.length} forbiddenClaims=${s.forbiddenClaimHits.length}`,
    );
  }
  lines.push('');
  lines.push(
    'Literal/keyword regression proxy only — not clinical factual accuracy, validation or release approval.',
  );
  lines.push(
    `Risk captured: ${report.riskHits}/${report.total} ` +
      `(${(report.riskHitRate * 100).toFixed(0)}%)  ·  ` +
      `mean fact recall ${report.meanFactRecall.toFixed(2)}  ·  ` +
      `all sections complete: ${report.sectionsCompleteAll ? 'yes' : 'NO'}`,
  );
  return lines.join('\n');
}
