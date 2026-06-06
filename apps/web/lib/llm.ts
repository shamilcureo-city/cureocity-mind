import { existsSync, writeFileSync } from 'node:fs';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiPass3Backend,
  MockGeminiPass4Backend,
  MockGeminiPass5Backend,
  ModelRouter,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProBriefBackend,
  VertexGeminiProClinicalBackend,
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
        model: process.env['VERTEX_CLINICAL_MODEL'] ?? process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro',
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
          process.env['VERTEX_BRIEF_MODEL'] ??
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
  });
}

export function modelRouter(): IModelRouter {
  if (!globalThis.__cureocityModelRouter) {
    globalThis.__cureocityModelRouter = build();
  }
  return globalThis.__cureocityModelRouter;
}
