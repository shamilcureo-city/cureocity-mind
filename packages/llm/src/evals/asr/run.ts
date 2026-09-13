import { MockAsrEngine, VertexAsrEngine, type IAsrEngine } from './engine';
import { asrGate } from './scorer';
import { formatAsrReport, runAsrEval } from './runner';
import { AsrEvaluationUnavailableError } from './wav';

/**
 * Sprint DS8 — `pnpm eval:asr`. Scores the code-mix seed set through an ASR
 * engine and prints the report + the drug-name gate verdict.
 *   ASR_ENGINE=vertex + ASR_ALLOW_PROVIDER_CALLS=true → an authorized real
 *                       WAV benchmark. Scribe's existing drug-name policy is
 *                       advisory and unchanged; unavailable input exits 2.
 *                       Mind has a separate failing command, eval:mind.
 *   mock (default)    → deterministic smoke run over the representative
 *                       hypotheses so the harness stays covered in CI.
 */
async function main(): Promise<void> {
  const engineName = process.env['ASR_ENGINE'] ?? 'mock';
  const engine: IAsrEngine =
    engineName === 'vertex'
      ? new VertexAsrEngine(process.env['ASR_AUDIO_DIR'], {
          projectId: process.env['VERTEX_PROJECT_ID'],
          model: process.env['VERTEX_FLASH_MODEL'],
          location: process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1',
          allowProviderCalls: process.env['ASR_ALLOW_PROVIDER_CALLS'] === 'true',
          vertical: 'DOCTOR',
        })
      : new MockAsrEngine();

  const report = await runAsrEval(engine);
  console.log(formatAsrReport(report));

  const gate = asrGate(report);
  if (engineName === 'mock') {
    console.log(
      '\n(mock engine — representative hypotheses, not real transcription; ' +
        'run ASR_ENGINE=vertex against actor-recorded audio for the real go/no-go)',
    );
    return;
  }
  // Real engine: the gate is advisory (voice-Rx already ships confirm-first),
  // but surface a clear signal for CI dashboards.
  console.log(`\nvoiceRxConfirmOnly=${gate.voiceRxConfirmOnly}`);
}

void main().catch((error: unknown) => {
  console.error(
    `NOT_EVALUATED: ${error instanceof AsrEvaluationUnavailableError ? error.code : 'ASR_EVALUATION_FAILED'}`,
  );
  process.exitCode = 2;
});
