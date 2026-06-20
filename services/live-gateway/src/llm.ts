import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  VertexGeminiFlashIndiaBackend,
  VertexGeminiProGlobalBackend,
  type IPass1Backend,
  type IPass2Backend,
} from '@cureocity/llm';

/**
 * Sprint DV4 — the live gateway's LLM backends. Reuses the SAME proven
 * Pass 1 (transcription) + Pass 2 (medical note) backends the batch
 * pipeline uses, so the live path is real, not scripted:
 *   LLM_BACKEND=mock   → deterministic output, runs locally, no creds.
 *   LLM_BACKEND=vertex → real Vertex Gemini (needs VERTEX_PROJECT_ID +
 *                        GOOGLE_APPLICATION_CREDENTIALS, asia-south1 for
 *                        DPDP residency on Pass 1).
 * The true token-streaming ASR is a latency optimisation layered on top
 * (see docs/DOCTOR_VERTICAL.md §4.3); this transcribes rolling windows.
 */
export interface LiveBackends {
  backend: string;
  pass1: IPass1Backend;
  pass2: IPass2Backend;
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
    };
  }
  return {
    backend,
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
  };
}
