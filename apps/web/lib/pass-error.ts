/**
 * Turn a pass failure into something a therapist can act on.
 *
 * `ClinicalReport.errorMessage` holds whatever the pass threw, and for a
 * schema rejection that is a serialised array of Zod issues — one object per
 * offending field, each repeating the full path and the list of allowed
 * values. A single drifted enum across a dozen quotes rendered as roughly two
 * thousand characters of JSON where the AI Copilot tab should have shown a
 * sentence, under a Retry button that could only reproduce it.
 *
 * The raw text still matters for support, so it is kept — this only decides
 * what leads. `summarise` returns a plain sentence; `detail` returns the
 * original for a collapsed <details>, or null when the message was already
 * readable and repeating it would just be noise.
 */

/** Cheap shape test: a serialised ZodError, not a human sentence. */
function looksLikeZodDump(message: string): boolean {
  return (
    message.length > 200 &&
    (message.includes('"code":') || message.includes('invalid_enum_value')) &&
    message.trimStart().startsWith('[')
  );
}

export interface PassErrorView {
  summary: string;
  /** The raw message, when it is too technical to lead with. */
  detail: string | null;
}

export function describePassError(
  message: string | null | undefined,
  fallback: string,
): PassErrorView {
  const raw = message?.trim();
  if (!raw) return { summary: fallback, detail: null };
  if (!looksLikeZodDump(raw)) return { summary: raw, detail: null };
  return {
    summary:
      "The AI's answer didn't match the expected format, so it was rejected rather than " +
      'saved. Retrying usually clears it — if it keeps happening, send us the details below.',
    detail: raw,
  };
}
