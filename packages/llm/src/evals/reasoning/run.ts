import type { IPassReasoningBackend } from '../../types';
import { MockGeminiReasoningBackend } from '../../backends/mock-gemini.backend';
import { VertexGeminiReasoningBackend } from '../../backends/vertex-reasoning.backend';
import { formatReport, passesGate, runReasoningEval } from './runner';

/**
 * Sprint DS2 — `pnpm eval:reasoning`. Runs the golden reasoning set through
 * the configured backend and prints the report.
 *   LLM_BACKEND=vertex → the REAL quality gate; exits non-zero below ≥10/12.
 *   mock (default)     → deterministic smoke run; always exits 0.
 */
async function main(): Promise<void> {
  const backendName = process.env['LLM_BACKEND'] ?? 'mock';
  let backend: IPassReasoningBackend;

  if (backendName === 'vertex') {
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) {
      console.error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
      process.exit(2);
    }
    backend = new VertexGeminiReasoningBackend({
      projectId: project,
      location: process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1',
      model:
        process.env['VERTEX_REASONING_MODEL'] ??
        process.env['VERTEX_FLASH_MODEL'] ??
        'gemini-2.5-flash',
    });
  } else {
    backend = new MockGeminiReasoningBackend();
  }

  const report = await runReasoningEval(backend);
  console.log(formatReport(report, backendName));

  if (backendName === 'vertex') {
    if (passesGate(report)) {
      console.log('\nGATE: PASS');
    } else {
      console.error('\nGATE: FAIL (need expected dx in top-3 for ≥10/12 + all rendered cited)');
      process.exit(1);
    }
  } else {
    console.log('\n(mock backend — smoke run only; run with LLM_BACKEND=vertex for the real gate)');
  }
}

void main();
