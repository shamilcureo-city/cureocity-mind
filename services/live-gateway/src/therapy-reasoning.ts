import type {
  TherapyAskNextItem,
  TherapyCarriedQuestion,
  TherapyLiveContext,
  TherapyReasoningModelOutput,
  TherapyReasoningV1,
  TherapyRiskSeverity,
  TherapyRiskWatchItem,
  TherapyThreadItem,
  Utterance,
} from '@cureocity/contracts';

/**
 * Sprint TS5 — the therapist's live reasoning holder (the CaseState analogue
 * for therapy). It merges each PASS_12 model output into a stable snapshot:
 *
 *   - CITATION GATE — a LIVE risk / ask / thread survives only if it cites an
 *     utterance id we've actually seen (the hallucination control). CARRIED
 *     items (planned questions) and the deterministic prior-SI re-check are
 *     gateway-seeded and exempt.
 *   - STABLE IDS — items are keyed by a slug of their content (label /
 *     question / topic), so re-emitting the same cue across passes updates it
 *     in place instead of flickering a new card. Dismissed ids stay dismissed.
 *   - DETERMINISTIC SAFETY — when prior suicidal ideation is on file, a
 *     "Re-check ideation" risk item is always present until dismissed,
 *     regardless of what the model returned.
 *   - THE ARC is computed here from elapsed vs planned minutes; the model
 *     never guesses the clock.
 *
 * `apply()` returns whether the emitted snapshot changed (content or arc
 * phase), so the session only emits a `therapyReasoning` event on real change.
 */
export class TherapyReasoningStore {
  private readonly carried: TherapyCarriedQuestion[];
  private readonly _priorRisk: boolean;
  private readonly plannedMin: number;

  private readonly seenIds = new Set<string>();
  private history: Utterance[] = [];
  private readonly dismissed = new Set<string>();

  private readonly liveRisk = new Map<string, TherapyRiskWatchItem>();
  private readonly liveAsk = new Map<string, TherapyAskNextItem>();
  private readonly threads = new Map<string, TherapyThreadItem>();

  private version = 0;
  private lastKey = '';
  private lastArcPhase = '';

  constructor(ctx: TherapyLiveContext | null) {
    this.carried = ctx?.carriedQuestions ?? [];
    this._priorRisk = ctx?.priorRisk ?? false;
    this.plannedMin = ctx?.plannedMinutes ?? 50;
  }

  get carriedQuestions(): TherapyCarriedQuestion[] {
    return this.carried;
  }

  get priorRisk(): boolean {
    return this._priorRisk;
  }

  registerUtterances(utterances: Utterance[]): void {
    for (const u of utterances) {
      this.seenIds.add(u.id);
      this.history.push(u);
    }
    if (this.history.length > 60) this.history = this.history.slice(-60);
  }

  /** A capped tail of already-seen utterances (excluding the new batch). */
  recentTail(excludeIds: Set<string>, max = 20): Utterance[] {
    return this.history.filter((u) => !excludeIds.has(u.id)).slice(-max);
  }

  previousThreads(): { id: string; topic: string }[] {
    return [...this.threads.values()].map((t) => ({ id: t.id, topic: t.topic }));
  }

  openLiveQuestions(): { id: string; question: string }[] {
    return [...this.liveAsk.values()]
      .filter((a) => !this.dismissed.has(a.id))
      .map((a) => ({ id: a.id, question: a.question }));
  }

  /** Mark an item dismissed. Returns whether it was newly dismissed. */
  dismiss(id: string): boolean {
    if (this.dismissed.has(id)) return false;
    this.dismissed.add(id);
    return true;
  }

  /**
   * Merge a model pass + recompute. Returns { changed, snapshot }. The model
   * output has already been Zod-validated; here we citation-gate + merge.
   */
  apply(
    model: TherapyReasoningModelOutput,
    elapsedMs: number,
  ): { changed: boolean; snapshot: TherapyReasoningV1 } {
    for (const r of model.riskWatch) {
      if (!this.cited(r.sourceUtteranceIds)) continue;
      const id = `risk-live-${slug(r.label)}`;
      this.liveRisk.set(id, { ...r, id, source: 'LIVE' });
    }
    for (const a of model.askNext) {
      if (!this.cited(a.sourceUtteranceIds)) continue;
      const id = `ask-live-${slug(a.question)}`;
      this.liveAsk.set(id, { ...a, id, source: 'LIVE', status: 'open' });
    }
    for (const t of model.threads) {
      if (!this.cited(t.sourceUtteranceIds)) continue;
      const id = `thread-${slug(t.topic)}`;
      const prev = this.threads.get(id);
      const mentions = Math.max(prev?.mentions ?? 0, t.mentions);
      const sourceUtteranceIds = Array.from(
        new Set([...(prev?.sourceUtteranceIds ?? []), ...t.sourceUtteranceIds]),
      );
      this.threads.set(id, { ...t, id, mentions, sourceUtteranceIds });
    }
    return this.recompute(elapsedMs);
  }

  /** Recompute the arc only (a minute tick) without a model pass. */
  recompute(elapsedMs: number): { changed: boolean; snapshot: TherapyReasoningV1 } {
    const snapshot = this.buildSnapshot(elapsedMs);
    const key = changeKey(snapshot);
    const changed = key !== this.lastKey || snapshot.arc?.phase !== this.lastArcPhase;
    if (changed) {
      this.version += 1;
      this.lastKey = key;
      this.lastArcPhase = snapshot.arc?.phase ?? '';
    }
    return { changed, snapshot: { ...snapshot, version: this.version } };
  }

  private cited(ids: string[]): boolean {
    return ids.some((id) => this.seenIds.has(id));
  }

  private buildSnapshot(elapsedMs: number): TherapyReasoningV1 {
    // Risk: the deterministic re-check (when prior SI + not dismissed) first,
    // then live cues, both severity-ordered.
    const risk: TherapyRiskWatchItem[] = [];
    if (this._priorRisk && !this.dismissed.has(RISK_RECHECK_ID)) {
      risk.push({
        id: RISK_RECHECK_ID,
        label: 'Re-check ideation',
        why: 'Prior suicidal ideation is on file — re-assess ideation, intent and means today.',
        severity: 'high',
        source: 'CARRIED_RISK',
        sourceUtteranceIds: [],
      });
    }
    for (const r of this.liveRisk.values()) {
      if (!this.dismissed.has(r.id)) risk.push(r);
    }
    risk.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

    // Ask-next: carried (planned) first, then live; open only, capped.
    const ask: TherapyAskNextItem[] = [];
    this.carried.forEach((q, i) => {
      const id = `carried-${i}`;
      if (this.dismissed.has(id)) return;
      ask.push({
        id,
        question: q.question,
        why: q.why ?? 'You planned to ask this at the start of the session.',
        source: 'CARRIED',
        priority: 'normal',
        status: 'open',
        sourceUtteranceIds: [],
      });
    });
    for (const a of this.liveAsk.values()) {
      if (!this.dismissed.has(a.id)) ask.push(a);
    }
    ask.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));

    const threads: TherapyThreadItem[] = [];
    for (const t of this.threads.values()) {
      if (!this.dismissed.has(t.id)) threads.push(t);
    }

    return {
      riskWatch: risk,
      askNext: ask.slice(0, 6),
      threads: threads.slice(0, 4),
      arc: buildArc(elapsedMs, this.plannedMin),
      version: this.version,
    };
  }
}

const RISK_RECHECK_ID = 'risk-recheck';

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function severityRank(s: TherapyRiskSeverity): number {
  return { low: 1, medium: 2, high: 3, critical: 4 }[s];
}

function priorityRank(p: 'high' | 'normal'): number {
  return p === 'high' ? 1 : 0;
}

function buildArc(elapsedMs: number, plannedMin: number): TherapyReasoningV1['arc'] {
  const elapsedMin = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (elapsedMin < 8) {
    return {
      phase: 'opening',
      elapsedMin,
      plannedMin,
      suggestion: 'Opening — set the focus for today and check in on the week.',
    };
  }
  if (elapsedMin < Math.floor(plannedMin * 0.85)) {
    return {
      phase: 'working',
      elapsedMin,
      plannedMin,
      suggestion: `Working phase · ${elapsedMin} of ${plannedMin} min.`,
    };
  }
  if (elapsedMin <= plannedMin) {
    return {
      phase: 'closing',
      elapsedMin,
      plannedMin,
      suggestion: `Consider moving toward homework and closing around ${plannedMin} min.`,
    };
  }
  return {
    phase: 'overrun',
    elapsedMin,
    plannedMin,
    suggestion: `${elapsedMin - plannedMin} min over — wrap up and schedule the next session.`,
  };
}

/** A stable key over the content (not elapsedMin) so a minute tick alone
 *  doesn't spam events — only content or an arc PHASE change emits. */
function changeKey(s: TherapyReasoningV1): string {
  return JSON.stringify({
    r: s.riskWatch.map((x) => [x.id, x.severity]),
    a: s.askNext.map((x) => [x.id, x.status]),
    t: s.threads.map((x) => [x.id, x.mentions]),
  });
}
