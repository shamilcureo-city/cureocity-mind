import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClinicalDiagnosisCandidateSchema } from '@cureocity/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DiagnosisSuggestionEvidence,
  diagnosisSuggestionEvidenceCounts,
  formatEvidenceTimestamp,
} from '../components/app/DiagnosisSuggestionEvidence';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) =>
    React.createElement('a', props, children),
}));

beforeAll(() => vi.stubGlobal('React', React));
afterAll(() => vi.unstubAllGlobals());

const candidate = ClinicalDiagnosisCandidateSchema.parse({
  icd11Code: '6B00',
  icd11Label: 'Synthetic test candidate',
  confidence: 0.84,
  supportingEvidence: [
    { quote: 'Fictional source statement one.', speaker: 'client', startMs: 62_400 },
    { quote: 'Fictional follow-up question.', speaker: 'therapist', startMs: 75_000 },
  ],
  gapsToFill: ['Clarify fictional duration.', 'Check fictional functional impact.'],
});

describe('diagnosis suggestion evidence presentation', () => {
  it('summarises only grounded quote and open-question counts', () => {
    expect(diagnosisSuggestionEvidenceCounts(candidate)).toEqual({
      evidenceCount: 2,
      openQuestionCount: 2,
      evidenceLabel: '2 transcript quotes',
      openQuestionLabel: '2 open questions',
    });
    expect(formatEvidenceTimestamp(62_400)).toBe('1:02');
  });

  it('keeps evidence, uncertainty and the source transcript together without presenting confidence as probability', () => {
    const html = renderToStaticMarkup(
      React.createElement(DiagnosisSuggestionEvidence, {
        candidate,
        sessionId: 'fictional-session',
      }),
    );

    expect(html).toContain('What supports this suggestion');
    expect(html).toContain('What remains unknown');
    expect(html).toContain('Fictional source statement one.');
    expect(html).toContain('Client · 1:02');
    expect(html).toContain('Psychologist · 1:15');
    expect(html).toContain('Clarify fictional duration.');
    expect(html).toContain('2 transcript quotes');
    expect(html).toContain('2 open questions');
    expect(html).toContain('href="/app/sessions/fictional-session?tab=transcript"');
    expect(html).toContain('Working hypothesis only.');
    expect(html).not.toContain('84%');
    expect(html.toLowerCase()).not.toContain('confidence');
  });

  it('does not turn an empty AI gap list into a claim that criteria are met', () => {
    const noGaps = ClinicalDiagnosisCandidateSchema.parse({
      ...candidate,
      supportingEvidence: [candidate.supportingEvidence[0]],
      gapsToFill: [],
    });
    const html = renderToStaticMarkup(
      React.createElement(DiagnosisSuggestionEvidence, {
        candidate: noGaps,
        sessionId: 'fictional-session',
      }),
    );

    expect(diagnosisSuggestionEvidenceCounts(noGaps).openQuestionLabel).toBe('no AI-listed gaps');
    expect(html).toContain('no missing criteria or questions');
    expect(html).toContain('does not mean diagnostic criteria are established');
  });
});
