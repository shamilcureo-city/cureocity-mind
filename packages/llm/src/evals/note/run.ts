import type { IPass2Backend } from '../../types';
import { MockGeminiPass2Backend } from '../../backends/mock-gemini.backend';
import { VertexGeminiProGlobalBackend } from '../../backends/vertex-pro-global.backend';
import { FLASH_PRICING } from '../../pricing';
import { formatReport, passesGate, runNoteEval } from './runner';

/**
 * Sprint 76 — `pnpm eval:note`. Runs the golden SOAP-note set through a Pass 2
 * backend and prints the report.
 *   LLM_BACKEND=vertex → the REAL quality gate; exits non-zero if any fixture
 *     under-flags its risk or mean fact recall < 0.6. This is the gate that
 *     decides Pass 2 → Flash: set LLM_PASS2_EVAL_MODEL=gemini-2.5-flash and
 *     only flip the production default if it passes.
 *   mock (default)     → deterministic smoke run; always exits 0.
 */
async function main(): Promise<void> {
  const backendName = process.env['LLM_BACKEND'] ?? 'mock';
  let backend: IPass2Backend;

  if (backendName === 'vertex') {
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) {
      console.error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
      process.exit(2);
    }
    // Candidate model under test — default Pro (the current production model).
    // Point LLM_PASS2_EVAL_MODEL at gemini-2.5-flash to score the Flash swap.
    const candidate =
      process.env['LLM_PASS2_EVAL_MODEL'] ?? process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
    const isFlash = /flash/i.test(candidate);
    backend = new VertexGeminiProGlobalBackend({
      projectId: project,
      location: process.env['VERTEX_PRO_REGION'] ?? 'global',
      model: candidate,
      ...(isFlash ? { pricing: FLASH_PRICING } : {}),
    });
    console.log(`(candidate model: ${candidate})`);
  } else {
    backend = new MockGeminiPass2Backend();
  }

  const report = await runNoteEval(backend);
  console.log(formatReport(report, backendName));

  if (backendName === 'vertex') {
    if (passesGate(report)) {
      console.log('\nGATE: PASS');
    } else {
      console.error('\nGATE: FAIL (a fixture under-flagged risk, or mean fact recall < 0.6)');
      process.exit(1);
    }
  } else {
    console.log('\n(mock backend — smoke run only; run with LLM_BACKEND=vertex for the real gate)');
  }
}

void main();
