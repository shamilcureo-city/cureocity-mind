/**
 * Renderer contract. Each renderer captures one of the response
 * archetypes the clinical catalog defines (thought_record,
 * binary_completed, mood_rating_0_10, free_text, exposure_log).
 *
 * `onSubmit` returns a Promise so the renderer can render a busy
 * state while the parent POSTs to /me/exercises/:id/completions.
 */
export interface RendererProps {
  exerciseTitle: string;
  description: string;
  onSubmit: (response: Record<string, unknown>, notes?: string) => Promise<void>;
  busy: boolean;
}
