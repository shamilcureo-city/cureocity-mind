import type { AskNextItem } from '@cureocity/contracts';

/**
 * Sprint DS3 — the "ask next" lifecycle engine (missing questions).
 *
 * Two sources feed one stream:
 *   - DIFFERENTIAL — from the reasoning pass; the questions that discriminate
 *     between the live differential candidates. Re-derived every cycle (the
 *     model is told the currently-open ones so it doesn't repeat), capped at
 *     3 open (alert-fatigue), highest clinical value first.
 *   - TEMPLATE — from the deterministic specialty-completeness engine;
 *     re-derived every cycle so a documented element's question disappears.
 *     Deduped against the differential-driven ones by shared keyword.
 *
 * Self-resolving: when the reasoning pass reports a question was answered
 * on-mic, its card flips to `answered` (emitted once for the ✓ animation)
 * then collapses and is never re-suggested. Dismissals persist for the whole
 * consult. Pure + DB-free so it unit-tests directly.
 */

/** Never show more than this many OPEN differential-driven questions. */
export const MAX_OPEN_DIFFERENTIAL = 3;

export class AskNextManager {
  /** Currently-open items (differential + template), keyed by id. */
  private readonly items = new Map<string, AskNextItem>();
  /** Items answered this cycle — emitted once (status answered) then cleared. */
  private justAnswered: AskNextItem[] = [];
  private readonly dismissedIds = new Set<string>();
  private readonly resolvedIds = new Set<string>();

  /**
   * Re-derive the differential-driven open set from the reasoning output.
   * Drops the previous differential items (the model re-produces the live
   * ones each cycle), skips dismissed/resolved, filters targets to kept dx,
   * and caps the open differential set at 3 (highest priority first).
   */
  ingestDifferential(incoming: AskNextItem[], keptDxIds: Set<string>): void {
    for (const [id, it] of this.items) {
      if (it.source === 'DIFFERENTIAL') this.items.delete(id);
    }
    const fresh = incoming
      .filter((raw) => !this.dismissedIds.has(raw.id) && !this.resolvedIds.has(raw.id))
      .sort(byPriority)
      .slice(0, MAX_OPEN_DIFFERENTIAL);
    for (const raw of fresh) {
      this.items.set(raw.id, {
        ...raw,
        source: 'DIFFERENTIAL',
        status: 'open',
        targetDxIds: raw.targetDxIds.filter((d) => keptDxIds.has(d)),
      });
    }
  }

  /**
   * Re-derive the template-driven open set. A gap that's now documented
   * simply isn't in `incoming`, so its question disappears. Skips
   * dismissed/resolved + anything that duplicates an open differential
   * question by shared keyword.
   */
  ingestTemplate(incoming: AskNextItem[]): void {
    for (const [id, it] of this.items) {
      if (it.source === 'TEMPLATE') this.items.delete(id);
    }
    for (const raw of incoming) {
      if (this.dismissedIds.has(raw.id) || this.resolvedIds.has(raw.id)) continue;
      if (this.duplicatesOpenDifferential(raw)) continue;
      this.items.set(raw.id, { ...raw, source: 'TEMPLATE', status: 'open' });
    }
  }

  /** Flip open items the reasoning pass reported answered → the ✓ buffer. */
  resolveAnswered(answeredIds: string[]): void {
    for (const id of answeredIds) {
      const it = this.items.get(id);
      if (it && it.status === 'open') {
        this.items.delete(id);
        this.resolvedIds.add(id);
        this.justAnswered.push({ ...it, status: 'answered' });
      }
    }
  }

  /** The doctor dismissed a question — never re-suggest it this consult. */
  dismiss(id: string): void {
    this.dismissedIds.add(id);
    this.items.delete(id);
    this.justAnswered = this.justAnswered.filter((a) => a.id !== id);
  }

  /** Differential-driven open questions fed back to the model (don't-repeat). */
  openForModel(): { id: string; question: string }[] {
    return [...this.items.values()]
      .filter((it) => it.source === 'DIFFERENTIAL')
      .map((it) => ({ id: it.id, question: it.question }));
  }

  hasJustAnswered(): boolean {
    return this.justAnswered.length > 0;
  }

  markEmitted(): void {
    this.justAnswered = [];
  }

  /** Ordered OPEN feed: high-priority first, differential (≤3) before template. */
  openFeed(): AskNextItem[] {
    const open = [...this.items.values()];
    const diff = open.filter((it) => it.source === 'DIFFERENTIAL').sort(byPriority);
    const tmpl = open.filter((it) => it.source === 'TEMPLATE').sort(byPriority);
    return [...diff.slice(0, MAX_OPEN_DIFFERENTIAL), ...tmpl];
  }

  /** The feed to emit: the open feed + this cycle's just-answered (✓). */
  feed(): AskNextItem[] {
    return [...this.openFeed(), ...this.justAnswered];
  }

  private duplicatesOpenDifferential(candidate: AskNextItem): boolean {
    const cand = significantTokens(candidate.question);
    for (const it of this.items.values()) {
      if (it.source !== 'DIFFERENTIAL') continue;
      const open = new Set(significantTokens(it.question));
      if (cand.some((t) => open.has(t))) return true;
    }
    return false;
  }
}

function byPriority(a: AskNextItem, b: AskNextItem): number {
  return (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1);
}

/** Content words (≥6 chars) — the dedup signal between the two sources. */
function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 6);
}
