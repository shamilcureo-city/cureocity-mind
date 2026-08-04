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

/**
 * What a pass failure is allowed to look like AT REST (S-hardening, 2026-08).
 *
 * `describePassError` below decides how a stored message is DISPLAYED; this
 * decides what gets STORED. A serialised ZodError repeats the `received`
 * value per issue — and in the incident that prompted this, the received
 * value was the client's name, persisted a dozen times into a plaintext
 * `errorMessage` column. Issue codes and paths diagnose the failure just as
 * well; received values never survive to the database.
 */
export function compactPassError(raw: string): string {
  const MAX = 500;
  const t = raw.trim();
  // Broader test than the display-side one: `looksLikeZodDump` requires
  // length > 200 (a short message is fine to SHOW), but at rest even a
  // truncated dump fragment can carry a received value — so any
  // issue-list-shaped string is compacted regardless of length.
  const dumpShaped =
    t.startsWith('[') && (t.includes('"code":') || t.includes('invalid_enum_value'));
  if (!dumpShaped) return t.length <= MAX ? t : `${t.slice(0, MAX - 1)}…`;
  try {
    const issues = JSON.parse(t) as Array<{ code?: string; path?: (string | number)[] }>;
    if (Array.isArray(issues) && issues.length > 0) {
      const paths = [
        ...new Set(
          issues.slice(0, 3).map((i) => (Array.isArray(i.path) ? i.path.join('.') : 'unknown')),
        ),
      ];
      const code = issues[0]?.code ?? 'invalid';
      return `AI output failed validation: ${issues.length} issue(s), e.g. ${code} at ${paths.join(', ')}`.slice(
        0,
        MAX,
      );
    }
  } catch {
    // Fall through — shaped like a dump but not parseable.
  }
  return 'AI output failed validation (unparseable issue list).';
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
