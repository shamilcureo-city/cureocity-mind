import type { Pass2Output } from '../../types';
import type { NoteFixture, RiskSeverity } from './fixtures';
import { containsAnnotatedPhrase, scoreAnnotations } from '../annotations';
import { containsTranscriptionArtifact } from '@cureocity/contracts';

/**
 * Sprint 76 — scorer for the SOAP-note eval. Three metrics, risk first:
 *   - riskHit:      retained under-flag check; over-flags are separate failures.
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
  riskFalseNegative: boolean;
  riskFalsePositive: boolean;
  capturedRisk: RiskSeverity;
  factRecall: number;
  matchedFacts: string[];
  missedFacts: string[];
  sectionsComplete: boolean;
  sourceAvailable: boolean;
  factDenominator: number;
  criticalOmissions: string[];
  forbiddenClaimHits: string[];
  annotationsValid: boolean;
  artifact: boolean;
  kindMatches: boolean;
}

/** Read the SOAP note out of a Pass 2 output; null for non-therapy kinds. */
function readNote(output: Pass2Output): {
  text: string;
  severity: RiskSeverity;
  sections: Record<string, string>;
  required: string[];
} | null {
  if (output.kind === 'TREATMENT' || output.kind === 'REVIEW') {
    const n = output.therapyNote;
    const sections = {
      subjective: n.subjective,
      objective: n.objective,
      assessment: n.assessment,
      plan: n.plan,
    };
    return {
      text: [
        ...Object.values(sections),
        n.summary ?? '',
        n.riskFlags.details ?? '',
        ...n.riskFlags.indicators,
        ...(n.topics ?? []).flatMap((t) => [t.title, ...t.points]),
        ...(n.templateSections ?? []).map((s) => s.body),
        ...n.phaseHints.map((hint) => hint.rationale ?? ''),
      ]
        .join('\n')
        .toLowerCase(),
      severity: n.riskFlags.severity,
      sections,
      required: ['subjective', 'objective', 'assessment', 'plan'],
    };
  }
  if (output.kind === 'INTAKE') {
    const n = output.intakeNote;
    const sections = {
      presentingConcerns: n.presentingConcerns,
      historyOfPresentingIllness: n.historyOfPresentingIllness,
      mentalStatusExam: n.mentalStatusExam,
      workingHypothesis: n.workingHypothesis,
      immediatePlan: n.immediatePlan,
      pastPsychiatricHistory: n.pastPsychiatricHistory,
      familyHistory: n.familyHistory,
      socialHistory: n.socialHistory,
    };
    return {
      text: [
        ...Object.values(sections),
        n.riskFlags.details ?? '',
        ...n.riskFlags.indicators,
        ...(n.templateSections ?? []).map((s) => s.body),
      ]
        .join('\n')
        .toLowerCase(),
      severity: n.riskFlags.severity,
      sections,
      required: [
        'presentingConcerns',
        'historyOfPresentingIllness',
        'mentalStatusExam',
        'workingHypothesis',
        'immediatePlan',
      ],
    };
  }
  return null; // MEDICAL — scored by the doctor eval, not here.
}

export function scoreFixture(fixture: NoteFixture, output: Pass2Output): NoteFixtureScore {
  const note = readNote(output);
  const sourceAvailable = fixture.segments.some((s) => s.text.trim().length > 0);
  if (!note) {
    return {
      id: fixture.id,
      language: fixture.language,
      riskHit: false,
      riskFalseNegative: fixture.expectRisk !== 'none',
      riskFalsePositive: false,
      capturedRisk: 'none',
      factRecall: 0,
      matchedFacts: [],
      missedFacts: fixture.expectFacts,
      sectionsComplete: false,
      sourceAvailable,
      factDenominator: fixture.expectFacts.length,
      criticalOmissions: (fixture.criticalFacts ?? []).map((f) => f.id),
      forbiddenClaimHits: [],
      annotationsValid: false,
      artifact: false,
      kindMatches: false,
    };
  }

  const matchedFacts = fixture.expectFacts.filter((f) => containsAnnotatedPhrase(note.text, f));
  const missedFacts = fixture.expectFacts.filter((f) => !containsAnnotatedPhrase(note.text, f));
  const annotations = scoreAnnotations(note.text, fixture.criticalFacts, fixture.forbiddenClaims);
  const maxRisk = fixture.expectRiskMax ?? fixture.expectRisk;
  const riskFalseNegative = SEVERITY_RANK[note.severity] < SEVERITY_RANK[fixture.expectRisk];
  const riskFalsePositive = SEVERITY_RANK[note.severity] > SEVERITY_RANK[maxRisk];

  return {
    id: fixture.id,
    language: fixture.language,
    riskHit: !riskFalseNegative,
    riskFalseNegative,
    riskFalsePositive,
    capturedRisk: note.severity,
    factRecall:
      fixture.expectFacts.length === 0 || !sourceAvailable
        ? 0
        : matchedFacts.length / fixture.expectFacts.length,
    matchedFacts,
    missedFacts,
    sectionsComplete: [...note.required, ...(fixture.requiredSections ?? [])].every(
      (key) => (note.sections[key] ?? '').trim().length > 0,
    ),
    sourceAvailable,
    factDenominator: fixture.expectFacts.length,
    criticalOmissions: annotations.missingRequired,
    forbiddenClaimHits: annotations.forbiddenPresent,
    annotationsValid:
      !annotations.invalid &&
      SEVERITY_RANK[maxRisk] >= SEVERITY_RANK[fixture.expectRisk] &&
      fixture.expectFacts.every((f) => f.trim().length > 0),
    artifact: containsTranscriptionArtifact(note.text),
    kindMatches: output.kind === (fixture.kind ?? 'TREATMENT'),
  };
}

export interface NoteEvalReport {
  source?: 'reference' | 'asr';
  scores: NoteFixtureScore[];
  total: number;
  riskHits: number;
  riskHitRate: number;
  meanFactRecall: number;
  sectionsCompleteAll: boolean;
  riskFalsePositives: number;
  riskFalseNegatives: number;
  criticalOmissions: number;
  forbiddenClaimHits: number;
  evaluable: boolean;
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
    riskFalsePositives: scores.filter((s) => s.riskFalsePositive).length,
    riskFalseNegatives: scores.filter((s) => s.riskFalseNegative).length,
    criticalOmissions: scores.reduce((n, s) => n + s.criticalOmissions.length, 0),
    forbiddenClaimHits: scores.reduce((n, s) => n + s.forbiddenClaimHits.length, 0),
    evaluable:
      total > 0 &&
      scores.every((s) => s.sourceAvailable && s.factDenominator > 0 && s.annotationsValid),
  };
}
