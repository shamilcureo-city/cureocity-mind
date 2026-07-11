import {
  FLASH_PRICING,
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  containerPolicyInput,
  resolveLlmBackend,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProGlobalBackend,
  VertexGeminiReasoningBackend,
  VertexGeminiTherapyReasoningBackend,
  type BackendPolicyInput,
  type IPass1Backend,
  type IPass2Backend,
  type IPassReasoningBackend,
  type IPassTherapyReasoningBackend,
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
  /** Interim note refreshes during the consult (cheap; debounced). */
  pass2: IPass2Backend;
  /**
   * Sprint 74 — the authoritative finalize note (what gets signed). Absent
   * (mock/dev), the session falls back to `pass2` for both.
   */
  pass2Final?: IPass2Backend;
  /** Sprint DS2 — combined live reasoning (findings + differential + ask-next). */
  reasoning: IPassReasoningBackend;
  /** Sprint TS5 — live THERAPY reasoning (risk-watch + ask-next + threads). */
  therapyReasoning: IPassTherapyReasoningBackend;
}

/**
 * TS-safety — how the gateway maps its (Cloud Run) environment onto the shared
 * backend policy. The Dockerfile sets NODE_ENV=production and Cloud Run injects
 * K_SERVICE, so any container deploy is "production" here → mock is refused.
 * A local gateway (NODE_ENV !== 'production') is not deployed → mock allowed.
 */
function gatewayBackendPolicyInput(): BackendPolicyInput {
  return containerPolicyInput(process.env);
}

export function buildBackends(): LiveBackends {
  // TS-safety — refuse the mock backend on a deployed gateway. Throws
  // MockBackendRefusedError at boot (server.ts calls this at module load), so a
  // misconfigured Cloud Run revision crash-loops loudly instead of serving live
  // consults on fabricated transcripts/notes. Mock is reachable only locally.
  const choice = resolveLlmBackend(gatewayBackendPolicyInput());
  if (choice === 'vertex') {
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) throw new Error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
    const flashRegion = process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1';
    const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
    return {
      backend: 'vertex',
      pass1: new VertexGeminiFlashIndiaBackend({
        projectId: project,
        location: flashRegion,
        model: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash',
      }),
      // Sprint 74 — interim note refreshes are display drafts, debounced in
      // the session (LIVE_NOTE_REFRESH_MS) and run on Flash by default; the
      // note the doctor signs comes from pass2Final (Pro). This was THE
      // dominant consult cost: an undebounced Pro note per 6–12 s window.
      pass2: new VertexGeminiProGlobalBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['LIVE_INTERIM_NOTE_MODEL'] ??
          process.env['VERTEX_FLASH_MODEL'] ??
          'gemini-2.5-flash',
        pricing: FLASH_PRICING,
      }),
      pass2Final: new VertexGeminiProGlobalBackend({
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
      // Sprint TS5 — live therapy reasoning. Flash in asia-south1 (DPDP),
      // same thinking budget as the doctor reasoning pass (latency-critical).
      therapyReasoning: new VertexGeminiTherapyReasoningBackend({
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
    backend: 'mock',
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    reasoning: new MockGeminiReasoningBackend(),
    therapyReasoning: new MockGeminiTherapyReasoningBackend(),
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
