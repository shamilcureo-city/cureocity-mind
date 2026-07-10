/**
 * Sprint TS4 — the progress report's "what we worked on" paragraph.
 *
 * Deterministic, patient-facing, warm plain language (rendered on the client
 * portal). Composed from the episode's session topics + the active plan's
 * goals + the modality, so the progress report reads like the therapist wrote
 * a sentence about the work — not just a chart of scores. Pure so it is
 * unit-testable without a DB.
 */

export interface FocusSummaryInput {
  /** A readable modality phrase, e.g. "cognitive behavioural therapy", or null. */
  modalityLabel: string | null;
  sessionsCompleted: number;
  /** Session topics gathered across the episode (may contain duplicates/case variants). */
  topics: string[];
  /** Active treatment-plan goal descriptions. */
  goals: string[];
}

/** Readable phrases for the SessionModality enum, for a therapeutic-focus line. */
const MODALITY_PHRASE: Record<string, string> = {
  CBT: 'cognitive behavioural therapy',
  EMDR: 'EMDR',
  ACT: 'acceptance and commitment therapy',
  IFS: 'internal family systems therapy',
  PSYCHODYNAMIC: 'psychodynamic therapy',
  MI: 'motivational interviewing',
  MBCT: 'mindfulness-based cognitive therapy',
  SUPPORTIVE: 'supportive counselling',
  OTHER: 'psychological therapy',
};

/** Map a stored modality enum to a readable phrase (null when unknown/absent). */
export function modalityFocusPhrase(modality: string | null | undefined): string | null {
  if (typeof modality !== 'string') return null;
  return MODALITY_PHRASE[modality] ?? null;
}

/** "a", "a and b", "a, b and c" — Oxford-free, patient-friendly. */
function listPhrase(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** De-duplicate case-insensitively, preserving first-seen casing + order. */
function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (t.length === 0) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function composeFocusSummary(input: FocusSummaryInput): string | null {
  const topics = dedupe(input.topics).slice(0, 3);
  const goals = dedupe(input.goals).slice(0, 2);
  if (topics.length === 0 && goals.length === 0) return null;

  const n = input.sessionsCompleted;
  const modality = input.modalityLabel ? ` of ${input.modalityLabel}` : '';
  const lead = n > 0 ? `Over ${n} session${n === 1 ? '' : 's'}${modality}` : 'In our work together';

  const sentences: string[] = [];
  if (topics.length > 0) {
    sentences.push(`${lead}, we focused on ${listPhrase(topics)}.`);
  } else {
    sentences.push(`${lead}, we worked steadily toward your goals.`);
  }
  if (goals.length > 0) {
    sentences.push(`We kept your goals in view: ${listPhrase(goals)}.`);
  }
  return sentences.join(' ');
}
