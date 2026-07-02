import type { CaseState, ClinicalFinding, PatientContext } from '@cureocity/contracts';

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

export class CaseStateStore {
  private state: CaseState;
  private readonly knownUtteranceIds = new Set<string>();

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
}
