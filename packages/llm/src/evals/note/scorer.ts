import type { Pass2Output } from '../../types';
import type { NoteFixture, RiskSeverity } from './fixtures';

/**
 * Sprint 76 — scorer for the SOAP-note eval. Three metrics, risk first:
 *   - riskHit:      the note captured AT LEAST the expected severity (never
 *                   under-flags a crisis). The safety-critical gate.
 *   - factRecall:   fraction of the fixture's expected facts present in the note.
 *   - sectionsComplete: all four SOAP sections are non-empty.
 */

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export interface NoteFixtureScore {
  id: string;
  language: NoteFixture['language'];
  /** Captured severity ≥ expected — false is a SAFETY miss. */
  riskHit: boolean;
  capturedRisk: RiskSeverity;
  factRecall: number;
  matchedFacts: string[];
  missedFacts: string[];
  sectionsComplete: boolean;
}

/** Read the SOAP note out of a Pass 2 output; null for non-therapy kinds. */
function readNote(
  output: Pass2Output,
): { text: string; severity: RiskSeverity; sections: string[] } | null {
  if (output.kind === 'TREATMENT' || output.kind === 'REVIEW') {
    const n = output.therapyNote;
    const sections = [n.subjective, n.objective, n.assessment, n.plan];
    return {
      text: [...sections, n.summary ?? '', n.riskFlags.details ?? '', ...n.riskFlags.indicators]
        .join('\n')
        .toLowerCase(),
      severity: n.riskFlags.severity,
      sections,
    };
  }
  if (output.kind === 'INTAKE') {
    const n = output.intakeNote;
    const sections = [
      n.presentingConcerns,
      n.historyOfPresentingIllness,
      n.mentalStatusExam,
      n.workingHypothesis,
      n.immediatePlan,
    ];
    return {
      text: [...sections, n.riskFlags.details ?? '', ...n.riskFlags.indicators]
        .join('\n')
        .toLowerCase(),
      severity: n.riskFlags.severity,
      sections,
    };
  }
  return null; // MEDICAL — scored by the doctor eval, not here.
}

export function scoreFixture(fixture: NoteFixture, output: Pass2Output): NoteFixtureScore {
  const note = readNote(output);
  if (!note) {
    return {
      id: fixture.id,
      language: fixture.language,
      riskHit: false,
      capturedRisk: 'none',
      factRecall: 0,
      matchedFacts: [],
      missedFacts: fixture.expectFacts,
      sectionsComplete: false,
    };
  }

  const matchedFacts = fixture.expectFacts.filter((f) => note.text.includes(f.toLowerCase()));
  const missedFacts = fixture.expectFacts.filter((f) => !note.text.includes(f.toLowerCase()));

  return {
    id: fixture.id,
    language: fixture.language,
    riskHit: SEVERITY_RANK[note.severity] >= SEVERITY_RANK[fixture.expectRisk],
    capturedRisk: note.severity,
    factRecall:
      fixture.expectFacts.length === 0 ? 1 : matchedFacts.length / fixture.expectFacts.length,
    matchedFacts,
    missedFacts,
    sectionsComplete: note.sections.every((s) => s.trim().length > 0),
  };
}

export interface NoteEvalReport {
  scores: NoteFixtureScore[];
  total: number;
  riskHits: number;
  riskHitRate: number;
  meanFactRecall: number;
  sectionsCompleteAll: boolean;
}

export function aggregate(scores: NoteFixtureScore[]): NoteEvalReport {
  const total = scores.length;
  const riskHits = scores.filter((s) => s.riskHit).length;
  const meanFactRecall = total === 0 ? 0 : scores.reduce((a, s) => a + s.factRecall, 0) / total;
  return {
    scores,
    total,
    riskHits,
    riskHitRate: total === 0 ? 0 : riskHits / total,
    meanFactRecall,
    sectionsCompleteAll: scores.every((s) => s.sectionsComplete),
  };
}
