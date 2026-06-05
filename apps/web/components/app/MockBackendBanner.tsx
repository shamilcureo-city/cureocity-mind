interface Props {
  llmBackend: string;
}

/**
 * Persistent warning that the LLM backend is in mock/placeholder mode.
 * Renders only when LLM_BACKEND !== 'vertex'. Mock mode is useful for
 * UI dev and CI, but in any environment doing real therapy work this
 * banner is the signal that:
 *   - Real Vertex Gemini was never called
 *   - The note placeholders are deterministic mock output, not AI
 *   - Audio chunks are uploaded but never transcribed
 *
 * Server-rendered (passes `llmBackend` down from process.env) so the
 * surface can't be fooled by a stale browser cache.
 */
export function MockBackendBanner({ llmBackend }: Props) {
  if (llmBackend === 'vertex') return null;
  return (
    <div className="mb-4 rounded-2xl border border-amber-400 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">
        ⚠ Mock LLM backend active (LLM_BACKEND={llmBackend || '<unset>'})
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Real transcription is not running. Notes are deterministic placeholders. To
        enable Vertex Gemini, set these env vars on the Vercel project and redeploy:
      </p>
      <ul className="mt-2 list-inside list-disc text-xs font-mono text-amber-900">
        <li>LLM_BACKEND=vertex</li>
        <li>VERTEX_PROJECT_ID=&lt;gcp project id&gt;</li>
        <li>GOOGLE_APPLICATION_CREDENTIALS_JSON=&lt;sa key json, one line&gt;</li>
      </ul>
    </div>
  );
}
