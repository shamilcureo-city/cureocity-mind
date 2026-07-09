import { describe, expect, it } from 'vitest';
import { verifyPass3Evidence, quoteVerified } from './pass3-evidence';

const TRANSCRIPT = [
  "Client: I haven't slept properly in weeks and I feel worthless most days.",
  'Therapist: When did the low mood start?',
  'Client: About two months ago, after I lost my job. Sometimes I think everyone would be better off without me.',
].join('\n');

function candidate(quotes: string[]) {
  return {
    icd11Code: '6A70',
    icd11Label: 'Depressive disorder',
    confidence: 0.6,
    supportingEvidence: quotes.map((q) => ({ quote: q, speaker: 'client', startMs: 0 })),
    gapsToFill: [],
  };
}

describe('quoteVerified', () => {
  const hay = "i haven't slept properly in weeks and i feel worthless most days";
  it('accepts a verbatim quote (punctuation/case-insensitive)', () => {
    expect(quoteVerified("I haven't slept properly in weeks", hay)).toBe(true);
  });
  it('rejects a fabricated quote', () => {
    expect(quoteVerified('I have been feeling euphoric and full of energy', hay)).toBe(false);
  });
  it('requires short quotes to match verbatim', () => {
    expect(quoteVerified('totally made up', hay)).toBe(false);
  });
  it('tolerates minor drift on long quotes (80% contiguous shingle)', () => {
    // one wrong trailing word, rest verbatim
    expect(quoteVerified("i haven't slept properly in weeks and i feel worthless every", hay)).toBe(
      true,
    );
  });
});

describe('verifyPass3Evidence — clinical report', () => {
  it('keeps candidates whose quotes are in the transcript', () => {
    const report = {
      diagnosisCandidates: [
        candidate(["I haven't slept properly in weeks and I feel worthless most days"]),
      ],
      primaryDiagnosisIndex: 0,
    };
    const { output, stats } = verifyPass3Evidence(report, TRANSCRIPT);
    const out = output as typeof report;
    expect(out.diagnosisCandidates).toHaveLength(1);
    expect(stats.quotesDropped).toBe(0);
    expect(out.primaryDiagnosisIndex).toBe(0);
  });

  it('drops a fabricated quote, and drops the candidate if it loses ALL evidence', () => {
    const report = {
      diagnosisCandidates: [
        candidate(['I feel euphoric and invincible and need no sleep']), // fabricated → dropped
        candidate(['Sometimes I think everyone would be better off without me']), // real → kept
      ],
      primaryDiagnosisIndex: 0,
    };
    const { output, stats } = verifyPass3Evidence(report, TRANSCRIPT);
    const out = output as typeof report;
    expect(out.diagnosisCandidates).toHaveLength(1);
    expect(stats.candidatesDropped).toBe(1);
    expect(stats.quotesDropped).toBe(1);
  });

  it('remaps primaryDiagnosisIndex when an earlier candidate is dropped', () => {
    const report = {
      diagnosisCandidates: [
        candidate(['completely invented quote about mania and grandiosity here']), // idx 0 dropped
        candidate(['About two months ago, after I lost my job']), // idx 1 → new idx 0
      ],
      primaryDiagnosisIndex: 1,
    };
    const out = verifyPass3Evidence(report, TRANSCRIPT).output as typeof report;
    expect(out.diagnosisCandidates).toHaveLength(1);
    expect(out.primaryDiagnosisIndex).toBe(0);
  });

  it('nulls primaryDiagnosisIndex when the pointed candidate is dropped', () => {
    const report = {
      diagnosisCandidates: [
        candidate(['fabricated grandiosity and pressured speech never said here']), // idx 0 dropped
        candidate(['About two months ago, after I lost my job']),
      ],
      primaryDiagnosisIndex: 0,
    };
    const out = verifyPass3Evidence(report, TRANSCRIPT).output as {
      diagnosisCandidates: unknown[];
      primaryDiagnosisIndex: number | null;
    };
    expect(out.primaryDiagnosisIndex).toBeNull();
  });
});

describe('verifyPass3Evidence — safety', () => {
  it('never empties a crisis flag: keeps original indicators if none verify', () => {
    const report = {
      diagnosisCandidates: [],
      crisisFlags: [
        {
          kind: 'suicidal_ideation',
          severity: 'high',
          indicators: [{ quote: 'a paraphrase the model invented', speaker: 'client', startMs: 0 }],
          recommendedAction: 'Assess safety and escalate.',
        },
      ],
    };
    const out = verifyPass3Evidence(report, TRANSCRIPT).output as typeof report;
    expect(out.crisisFlags).toHaveLength(1);
    expect(out.crisisFlags[0].indicators).toHaveLength(1); // preserved for safety
  });

  it('passes through unchanged when no transcript is supplied', () => {
    const report = { diagnosisCandidates: [candidate(['anything at all goes here'])] };
    const out = verifyPass3Evidence(report, '').output as typeof report;
    expect(out.diagnosisCandidates).toHaveLength(1);
  });
});
