import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProGlobalBackend,
  VertexGeminiReasoningBackend,
  type IPass1Backend,
  type IPass2Backend,
  type IPassReasoningBackend,
} from '@cureocity/llm';

/**
 * Sprint DV4 + DS2 — the live gateway's LLM backends.
 *   Pass 1  (transcription)  — Flash, asia-south1 (DPDP residency).
 *   Pass 2  (medical note)    — Pro, global.
 *   Reasoning (DS2)           — Flash, asia-south1, ONE combined call per
 *     cycle producing findings-δ + differential + ask-next + red flags
 *     (DS1's findings pass is folded in). This supersedes the standalone
 *     findings backend as the gateway's reasoning substrate.
 *
 *   LLM_BACKEND=mock   → deterministic output, runs locally, no creds.
 *   LLM_BACKEND=vertex → real Vertex Gemini.
 */
export interface LiveBackends {
  backend: string;
  pass1: IPass1Backend;
  pass2: IPass2Backend;
  /** Sprint DS2 — combined live reasoning (findings + differential + ask-next). */
  reasoning: IPassReasoningBackend;
}

export function buildBackends(): LiveBackends {
  const backend = process.env['LLM_BACKEND'] ?? 'mock';
  if (backend === 'vertex') {
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) throw new Error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
    const flashRegion = process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1';
    const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
    return {
      backend,
      pass1: new VertexGeminiFlashIndiaBackend({
        projectId: project,
        location: flashRegion,
        model: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash',
      }),
      pass2: new VertexGeminiProGlobalBackend({
        projectId: project,
        location: proRegion,
        model: process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro',
      }),
      // Sprint DS2 — combined reasoning. Flash in asia-south1 (DPDP; the
      // transcript is PII), reuses the Flash model env.
      // Sprint 74 — thinking disabled by default: findings extraction is
      // latency-critical and doesn't need deliberation; uncapped thinking
      // added seconds per cycle (and cost). -1 restores automatic.
      reasoning: new VertexGeminiReasoningBackend({
        projectId: project,
        location: flashRegion,
        model:
          process.env['VERTEX_REASONING_MODEL'] ??
          process.env['VERTEX_FLASH_MODEL'] ??
          'gemini-2.5-flash',
        thinkingBudget: reasoningThinkingBudget(),
      }),
    };
  }
  return {
    backend,
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
  };
}

/**
 * Sprint 74 — LIVE_REASONING_THINKING_BUDGET env: 0 (default) disables
 * thinking on the live reasoning pass, -1 restores the model's automatic
 * budget, any positive integer caps it. Garbage falls back to 0.
 */
function reasoningThinkingBudget(): number {
  const raw = process.env['LIVE_REASONING_THINKING_BUDGET'];
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= -1 ? n : 0;
}
