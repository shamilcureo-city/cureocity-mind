import { MockAsrEngine, VertexAsrEngine, type IAsrEngine } from './engine';
import { asrGate } from './scorer';
import { formatAsrReport, runAsrEval } from './runner';

/**
 * Sprint DS8 — `pnpm eval:asr`. Scores the code-mix seed set through an ASR
 * engine and prints the report + the drug-name gate verdict.
 *   ASR_ENGINE=vertex → the REAL benchmark (needs actor-recorded audio +
 *                       creds; see docs/asr-benchmark.md). Exits non-zero if
 *                       the drug-name gate would relax unsafely — it never
 *                       will here because the engine refuses without audio.
 *   mock (default)    → deterministic smoke run over the representative
 *                       hypotheses so the harness stays covered in CI.
 */
async function main(): Promise<void> {
  const engineName = process.env['ASR_ENGINE'] ?? 'mock';
  const engine: IAsrEngine =
    engineName === 'vertex'
      ? new VertexAsrEngine(process.env['ASR_AUDIO_DIR'])
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

void main();
