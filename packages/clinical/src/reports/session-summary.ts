import type { SessionKind } from '@cureocity/contracts';

/**
 * Sprint TS4 — the per-session one-liner shown in the case file.
 *
 * The old case-file builder truncated the SOAP `plan` (falling back to
 * `assessment`) to 160 chars — it showed "what we'll do next", not what the
 * session was about, and never used the note's own plain-language `summary`
 * (Pass 2, Sprint 70) even though it was right there in the content JSON.
 *
 * This prefers that real `summary`, then the clinical `assessment` (a
 * descriptive impression reads better as a one-liner than a plan), then the
 * `plan`. INTAKE notes have no `summary` field, so they key off
 * `presentingConcerns` → `workingHypothesis`. Pure + defensive (bad stored
 * JSON yields `null`, never throws) so it can be unit-tested without a DB.
 */

/** A comfortable cap for a case-file row — fits a 2–4 sentence summary. */
const MAX_CHARS = 300;

const TREATMENT_KEYS = ['summary', 'assessment', 'plan'] as const;
const INTAKE_KEYS = ['presentingConcerns', 'workingHypothesis'] as const;

export function sessionSummaryLine(kind: SessionKind, content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;
  const c = content as Record<string, unknown>;
  const keys = kind === 'INTAKE' ? INTAKE_KEYS : TREATMENT_KEYS;
  for (const key of keys) {
    const value = c[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return clamp(value.trim().replace(/\s+/g, ' '));
    }
  }
  return null;
}

function clamp(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS - 1).trimEnd()}…`;
}
