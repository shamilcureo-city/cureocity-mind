import { containsTranscriptionArtifact } from '@cureocity/contracts';
import type { IAsrEngine } from '../asr/engine';
import { wordErrorRate } from '../asr/wer';
import { scoreAnnotations } from '../annotations';
import type { MindAudioFixture, MindAudioManifest } from './manifest';

export interface MindAudioScore {
  id: string;
  language: MindAudioFixture['language'];
  purpose: MindAudioFixture['purpose'];
  split: MindAudioFixture['split'];
  failed: boolean;
  wordErrors: number;
  referenceWords: number;
  silenceInsertion: boolean;
  artifact: boolean;
  criticalMisses: number;
  forbiddenHits: number;
  invalidAnnotations: boolean;
}

export interface MindAudioReport {
  status: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  /** Never true: even a real-audio WER run is not clinical validation. */
  clinicalValidation: false;
  evidence: 'real-audio' | 'injected';
  total: number;
  heldOut: number;
  failedCases: number;
  heldOutWer: number | null;
  byLanguage: Record<string, { cases: number; wer: number | null; failures: number }>;
  reasons: string[];
  scores: MindAudioScore[];
}

export async function runMindAudioEval(
  engine: IAsrEngine<MindAudioFixture>,
  manifest: MindAudioManifest,
  evidence: MindAudioReport['evidence'] = 'injected',
): Promise<MindAudioReport> {
  const scores: MindAudioScore[] = [];
  for (const fixture of manifest.fixtures) {
    // Invalid annotations must not consume a paid call or silently improve a score.
    const referenceAnnotations = scoreAnnotations(
      fixture.reference,
      fixture.criticalPhrases,
      fixture.forbiddenPhrases,
    );
    const invalidAnnotations =
      referenceAnnotations.invalid ||
      referenceAnnotations.missingRequired.length > 0 ||
      referenceAnnotations.forbiddenPresent.length > 0;
    let hypothesis = '';
    let failed = invalidAnnotations;
    if (!failed) {
      try {
        hypothesis = await engine.transcribe(fixture);
      } catch {
        failed = true;
      }
    }
    const words = wordErrorRate(fixture.reference, hypothesis);
    const annotations = scoreAnnotations(
      hypothesis,
      fixture.criticalPhrases,
      fixture.forbiddenPhrases,
    );
    scores.push({
      id: fixture.id,
      language: fixture.language,
      purpose: fixture.purpose,
      split: fixture.split,
      failed,
      wordErrors: words.errors,
      referenceWords: words.refWords,
      silenceInsertion: words.refWords === 0 && words.errors > 0,
      artifact: containsTranscriptionArtifact(hypothesis),
      criticalMisses: annotations.missingRequired.length,
      forbiddenHits: annotations.forbiddenPresent.length,
      invalidAnnotations,
    });
  }
  const held = scores.filter((s) => s.split === 'held-out');
  const wer = (rows: MindAudioScore[]) => {
    const words = rows.reduce((sum, row) => sum + row.referenceWords, 0);
    return words ? rows.reduce((sum, row) => sum + row.wordErrors, 0) / words : null;
  };
  const byLanguage: MindAudioReport['byLanguage'] = {};
  const reasons: string[] = [];
  let notEvaluated = false;
  if (held.length < manifest.limits.minHeldOutCases || held.length === 0) {
    reasons.push('INSUFFICIENT_HELD_OUT_CASES');
    notEvaluated = true;
  }
  const heldOutWer = wer(held);
  if (heldOutWer === null) {
    reasons.push('NO_REFERENCE_WORDS');
    notEvaluated = true;
  } else if (heldOutWer > manifest.limits.maxWordErrorRate) reasons.push('HELD_OUT_WER_EXCEEDED');
  for (const language of new Set([
    ...manifest.limits.requiredLanguages,
    ...held.map((s) => s.language),
  ])) {
    const rows = held.filter((s) => s.language === language);
    const languageWer = wer(rows);
    byLanguage[language] = {
      cases: rows.length,
      wer: languageWer,
      failures: rows.filter((s) => s.failed).length,
    };
    if (rows.length < manifest.limits.minCasesPerLanguage || languageWer === null) {
      reasons.push(`INSUFFICIENT_LANGUAGE_COVERAGE_${language}`);
      notEvaluated = true;
    } else if (languageWer > manifest.limits.maxWordErrorRate)
      reasons.push(`LANGUAGE_WER_EXCEEDED_${language}`);
  }
  if (scores.some((s) => s.invalidAnnotations)) {
    reasons.push('INVALID_ANNOTATIONS');
    notEvaluated = true;
  }
  if (scores.length > 0 && scores.every((s) => s.failed)) {
    reasons.push('NO_SUCCESSFUL_TRANSCRIPTIONS');
    notEvaluated = true;
  }
  if (scores.some((s) => s.failed)) reasons.push('TRANSCRIPTION_FAILED');
  // Development scores cannot rescue held-out WER, and a known critical
  // regression in either split cannot be ignored simply because it is not held out.
  if (scores.some((s) => s.artifact || s.silenceInsertion || s.criticalMisses || s.forbiddenHits))
    reasons.push('ANNOTATED_REGRESSION');
  return {
    status: notEvaluated ? 'NOT_EVALUATED' : reasons.length ? 'FAIL' : 'PASS',
    clinicalValidation: false,
    evidence,
    total: scores.length,
    heldOut: held.length,
    failedCases: scores.filter((s) => s.failed).length,
    heldOutWer,
    byLanguage,
    reasons,
    scores,
  };
}

export function mindAudioExitCode(report: MindAudioReport): number {
  // Injected/mocked successes can prove the harness, never a release gate.
  return report.status === 'NOT_EVALUATED' || report.evidence !== 'real-audio'
    ? 2
    : report.status === 'FAIL'
      ? 1
      : 0;
}
