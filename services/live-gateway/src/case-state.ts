import type {
  AskNextItem,
  CaseState,
  ClinicalFinding,
  LiveDifferentialItem,
  LiveReasoning,
  LiveRedFlag,
  PatientContext,
} from '@cureocity/contracts';

/**
 * Sprint DS1 — the per-consult CaseState store (the reasoning substrate).
 *
 * Holds the running clinical picture the findings pass (and later the DS2
 * differential + DS3 ask-next engines) read from and write to. Two jobs:
 *
 *   1. Merge PassFindings deltas with STABLE identities — a finding whose
 *      id already exists is replaced in place (so a polarity flip or a
 *      detail correction updates rather than duplicates); a new id appends.
 *
 *   2. Enforce the CITATION GATE (the hallucination control, §0.1.2): a
 *      finding is accepted only if it cites ≥1 utterance id AND every cited
 *      id is a real utterance the gateway has actually seen. Findings that
 *      cite fabricated utterance ids are dropped before they ever reach the
 *      state — never rendered.
 *
 * Pure + DB-free so it unit-tests directly.
 */

const DEFAULT_PATIENT: PatientContext = {
  sex: 'unknown',
  knownConditions: [],
  activeMeds: [],
  allergies: [],
};

export interface ApplyFindingsResult {
  /** Findings that passed the citation gate and were merged. */
  accepted: ClinicalFinding[];
  /** Findings dropped because their citations don't resolve. */
  dropped: ClinicalFinding[];
  /** True if the merge changed the state (→ worth emitting). */
  changed: boolean;
}

export interface ApplyReasoningResult {
  /** Differential candidates that survived the citation gate + cap. */
  differential: LiveDifferentialItem[];
  /** Candidates dropped because no cited finding resolves. */
  dropped: LiveDifferentialItem[];
  /** True if the reasoning snapshot changed (→ worth emitting). */
  changed: boolean;
  version: number;
}

/** Cap on OPEN differential-driven ask-next questions (alert-fatigue rule). */
const MAX_OPEN_ASK_NEXT = 3;
/** Cap on rendered differential candidates. */
const MAX_DIFFERENTIAL = 5;

export class CaseStateStore {
  private state: CaseState;
  private readonly knownUtteranceIds = new Set<string>();

  // Sprint DS2 — the reasoning snapshot (kept alongside CaseState, not part
  // of the CaseState contract). Monotonic `reasoningVersion` for idempotent
  // client render + drop-superseded.
  private dx: LiveDifferentialItem[] = [];
  private ask: AskNextItem[] = [];
  private flags: LiveRedFlag[] = [];
  private reasoningVersion = 0;
  private lastReasoningJson = '';

  constructor(patient?: PatientContext) {
    this.state = {
      patient: patient ?? DEFAULT_PATIENT,
      findings: [],
      answeredQuestionIds: [],
      version: 0,
    };
  }

  /** Register an utterance the gateway has produced, so its id can be cited. */
  registerUtterance(id: string): void {
    if (id) this.knownUtteranceIds.add(id);
  }

  get snapshot(): CaseState {
    return this.state;
  }

  get findings(): ClinicalFinding[] {
    return this.state.findings;
  }

  get version(): number {
    return this.state.version;
  }

  /** The current differential (fed back into the next reasoning pass). */
  get differential(): LiveDifferentialItem[] {
    return this.dx;
  }

  /** The full reasoning snapshot to emit (differential + ask-next + red flags). */
  get reasoning(): LiveReasoning {
    return {
      differential: this.dx,
      askNext: this.ask,
      redFlags: this.flags,
      version: this.reasoningVersion,
    };
  }

  /**
   * Merge a PassFindings result. Gates each finding on its citations,
   * replaces-by-id / appends the survivors, unions answered-question ids,
   * and bumps `version` iff something actually changed.
   */
  applyFindings(
    findings: ClinicalFinding[],
    answeredQuestionIds: string[] = [],
  ): ApplyFindingsResult {
    const accepted: ClinicalFinding[] = [];
    const dropped: ClinicalFinding[] = [];
    for (const f of findings) {
      if (this.isCited(f)) accepted.push(f);
      else dropped.push(f);
    }

    const byId = new Map(this.state.findings.map((f) => [f.id, f] as const));
    for (const f of accepted) byId.set(f.id, f); // replace in place or append

    const answeredBefore = this.state.answeredQuestionIds.length;
    const answered = new Set([...this.state.answeredQuestionIds, ...answeredQuestionIds]);
    const answeredChanged = answered.size !== answeredBefore;

    const changed = accepted.length > 0 || answeredChanged;
    if (changed) {
      this.state = {
        ...this.state,
        findings: [...byId.values()],
        answeredQuestionIds: [...answered],
        version: this.state.version + 1,
      };
    }
    return { accepted, dropped, changed };
  }

  /** A finding is cited iff it names ≥1 utterance id and ALL are real. */
  private isCited(f: ClinicalFinding): boolean {
    if (f.utteranceIds.length === 0) return false;
    return f.utteranceIds.every((id) => this.knownUtteranceIds.has(id));
  }

  /**
   * Sprint DS2 — apply a reasoning pass output. The CITATION GATE for the
   * differential: each candidate's `evidenceFor` is filtered to real finding
   * ids and the candidate is DROPPED if none survive (uncited dx never
   * render). Then cap at 5, keep ≤3 open differential-driven questions
   * (alert-fatigue), and filter red-flag/ask-next references to live ids.
   * Bumps the monotonic reasoning version iff the snapshot changed.
   *
   * Call `applyFindings` FIRST for the same pass so this validates against
   * the freshly-merged finding set.
   */
  applyReasoning(
    differential: LiveDifferentialItem[],
    askNext: AskNextItem[] = [],
    redFlags: LiveRedFlag[] = [],
  ): ApplyReasoningResult {
    const knownFindingIds = new Set(this.state.findings.map((f) => f.id));

    const kept: LiveDifferentialItem[] = [];
    const dropped: LiveDifferentialItem[] = [];
    for (const d of differential) {
      const evidenceFor = d.evidenceFor.filter((id) => knownFindingIds.has(id));
      if (evidenceFor.length === 0) {
        dropped.push(d);
        continue;
      }
      kept.push({
        ...d,
        evidenceFor,
        evidenceAgainst: d.evidenceAgainst.filter((id) => knownFindingIds.has(id)),
      });
    }
    const cappedDx = kept.slice(0, MAX_DIFFERENTIAL);
    const keptDxIds = new Set(cappedDx.map((d) => d.id));

    const openAsk = askNext
      .filter((a) => a.status === 'open')
      .map((a) => ({ ...a, targetDxIds: a.targetDxIds.filter((id) => keptDxIds.has(id)) }))
      .slice(0, MAX_OPEN_ASK_NEXT);

    const cleanFlags = redFlags.map((r) => ({
      ...r,
      findingIds: r.findingIds.filter((id) => knownFindingIds.has(id)),
    }));

    const json = JSON.stringify({ d: cappedDx, a: openAsk, f: cleanFlags });
    const changed = json !== this.lastReasoningJson;
    if (changed) {
      this.lastReasoningJson = json;
      this.dx = cappedDx;
      this.ask = openAsk;
      this.flags = cleanFlags;
      this.reasoningVersion += 1;
    }
    return { differential: cappedDx, dropped, changed, version: this.reasoningVersion };
  }
}
