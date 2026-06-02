import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  ModelRouter,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProGlobalBackend,
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

function build(): IModelRouter {
  const backend = process.env['LLM_BACKEND'] ?? 'mock';
  if (backend === 'vertex') {
    const project = process.env['VERTEX_PROJECT_ID'];
    if (!project) throw new Error('LLM_BACKEND=vertex requires VERTEX_PROJECT_ID');
    return new ModelRouter({
      pass1: new VertexGeminiFlashIndiaBackend({
        projectId: project,
        location: process.env['VERTEX_FLASH_REGION'] ?? 'asia-south1',
        model: process.env['VERTEX_FLASH_MODEL'] ?? 'gemini-2.5-flash',
      }),
      pass2: new VertexGeminiProGlobalBackend({
        projectId: project,
        location: process.env['VERTEX_PRO_REGION'] ?? 'global',
        model: process.env['VERTEX_PRO_MODEL'] ?? 'gemini-2.5-pro',
      }),
    });
  }
  return new ModelRouter({
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
  });
}

export function modelRouter(): IModelRouter {
  if (!globalThis.__cureocityModelRouter) {
    globalThis.__cureocityModelRouter = build();
  }
  return globalThis.__cureocityModelRouter;
}
