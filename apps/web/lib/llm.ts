import { existsSync, writeFileSync } from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiPass3Backend,
  MockGeminiPass4Backend,
  MockGeminiPass5Backend,
  MockGeminiPass6Backend,
  MockGeminiPass7Backend,
  MockGeminiPass8Backend,
  ModelRouter,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProBriefBackend,
  VertexGeminiProCaseBriefingBackend,
  VertexGeminiProCaseConsultBackend,
  VertexGeminiProClinicalBackend,
  VertexGeminiProConceptualMapBackend,
  VertexGeminiProGlobalBackend,
  VertexGeminiProTherapyScriptBackend,
  type IModelRouter,
} from '@cureocity/llm';

/**
 * Boots the ModelRouter from env. Two backends:
 *   LLM_BACKEND=mock    — MockGeminiBackend, deterministic output.
 *                          Used when VERTEX_* env vars are unset.
 *   LLM_BACKEND=vertex  — Real Vertex Gemini. Pass 1 in
 *                          VERTEX_FLASH_REGION (default asia-south1),
 *                          Pass 2 in VERTEX_PRO_REGION (default global).
 *
 * Defaults to Gemini 2.5 Flash + 2.5 Pro — best quality/cost balance
 * for the scribe pipeline. Override via VERTEX_FLASH_MODEL /
 * VERTEX_PRO_MODEL for A/B comparisons (e.g. 2.5 Pro on both passes
 * for max-capability, or pinning to 1.5 for a cost floor).
 *
 * Cached module-globally so warm function reuse skips re-init.
 */

declare global {
  var __cureocityModelRouter: IModelRouter | undefined;
}

/**
 * Vercel functions have no persistent filesystem and the Vertex SDK
 * reads credentials from a file path (GOOGLE_APPLICATION_CREDENTIALS).
 * We accept the full JSON in GOOGLE_APPLICATION_CREDENTIALS_JSON and
 * materialise it to /tmp on cold start so the SDK can find it. /tmp
 * survives for the warm lifetime of the function container and is
 * recreated automatically on the next cold start.
 *
 * No-op if GOOGLE_APPLICATION_CREDENTIALS is already set (e.g. local
 * dev with a real path) or if the JSON env var is absent (mock backend).
 */
const VERCEL_CREDS_PATH = '/tmp/gcp-credentials.json';

export function ensureGcpCreds(): void {
  if (process.env['GOOGLE_APPLICATION_CREDENTIALS']) return;
  const json = process.env['GOOGLE_APPLICATION_CREDENTIALS_JSON'];
  if (!json) return;
  if (!existsSync(VERCEL_CREDS_PATH)) {
    writeFileSync(VERCEL_CREDS_PATH, json, { mode: 0o600 });
  }
  process.env['GOOGLE_APPLICATION_CREDENTIALS'] = VERCEL_CREDS_PATH;
}

function build(): IModelRouter {
  const backend = process.env['LLM_BACKEND'] ?? 'mock';
  if (backend === 'vertex') {
    ensureGcpCreds();
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) throw new Error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
    const flashRegion = process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1';
    const proRegion = process.env['VERTEX_PRO_REGION'] ?? 'global';
    console.info(
      `[llm] backend=vertex project=${project} flashRegion=${flashRegion} proRegion=${proRegion} flashModel=${process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash'} proModel=${process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro'}`,
    );
    return new ModelRouter({
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
      pass3: new VertexGeminiProClinicalBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_CLINICAL_MODEL'] ??
          process.env['VERTEX_PRO_MODEL'] ??
          'gemini-2.5-pro',
      }),
      pass4: new VertexGeminiProTherapyScriptBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_THERAPY_SCRIPT_MODEL'] ??
          process.env['VERTEX_PRO_MODEL'] ??
          'gemini-2.5-pro',
      }),
      pass5: new VertexGeminiProBriefBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_BRIEF_MODEL'] ?? process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro',
      }),
      pass6: new VertexGeminiProCaseBriefingBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_BRIEF_MODEL'] ?? process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro',
      }),
      pass7: new VertexGeminiProConceptualMapBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_CONCEPTUAL_MAP_MODEL'] ??
          process.env['VERTEX_PRO_MODEL'] ??
          'gemini-2.5-pro',
      }),
      // Sprint 52 — Pass 8 Case Consult. Reuses the Pro model env so a
      // single override toggles both Pass 6 + 8; both are reasoning-
      // heavy briefing-shaped passes.
      pass8: new VertexGeminiProCaseConsultBackend({
        projectId: project,
        location: proRegion,
        model:
          process.env['VERTEX_CASE_CONSULT_MODEL'] ??
          process.env['VERTEX_PRO_MODEL'] ??
          'gemini-2.5-pro',
      }),
    });
  }
  console.info(
    `[llm] backend=mock LLM_BACKEND_value='${process.env['LLM_BACKEND'] ?? '<unset>'}' — Vertex not selected; check env var spelling/case`,
  );
  return new ModelRouter({
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
    pass3: new MockGeminiPass3Backend(),
    pass4: new MockGeminiPass4Backend(),
    pass5: new MockGeminiPass5Backend(),
    pass6: new MockGeminiPass6Backend(),
    pass7: new MockGeminiPass7Backend(),
    pass8: new MockGeminiPass8Backend(),
  });
}

export function modelRouter(): IModelRouter {
  if (!globalThis.__cureocityModelRouter) {
    globalThis.__cureocityModelRouter = build();
  }
  return globalThis.__cureocityModelRouter;
}

export interface LlmSelfTestResult {
  ok: boolean;
  backend: string;
  project?: string;
  region?: string;
  model?: string;
  latencyMs?: number;
  sample?: string;
  error?: string;
}

/**
 * Sprint 41 — Vertex connectivity self-test.
 *
 * Runs ONE tiny real generateContent against the configured Pro model +
 * region so an operator can confirm "is real LLM actually wired?" without
 * recording a whole session. On the mock backend it's a no-op success
 * (nothing to call). Failures surface the raw Vertex error (bad creds,
 * model not available in the region, project not allowlisted, …) which
 * is exactly what you need to debug the cutover.
 */
export async function llmSelfTest(): Promise<LlmSelfTestResult> {
  const backend = process.env['LLM_BACKEND'] ?? 'mock';
  if (backend !== 'vertex') {
    return { ok: true, backend, sample: 'mock backend — no real LLM call made' };
  }
  ensureGcpCreds();
  const project = process.env['VERTEX_PROJECT_ID'];
  if (!project) {
    return { ok: false, backend, error: 'LLM_BACKEND=vertex but VERTEX_PROJECT_ID is not set' };
  }
  const region = process.env['VERTEX_PRO_REGION'] ?? 'global';
  const model = process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro';
  try {
    const ai = new GoogleGenAI({ vertexai: true, project, location: region });
    const start = Date.now();
    const res = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
      config: { temperature: 0, maxOutputTokens: 16 },
    });
    const latencyMs = Date.now() - start;
    return {
      ok: true,
      backend,
      project,
      region,
      model,
      latencyMs,
      sample: (res.text ?? '').trim().slice(0, 40),
    };
  } catch (e) {
    return { ok: false, backend, project, region, model, error: (e as Error).message };
  }
}
