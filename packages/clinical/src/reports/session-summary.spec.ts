import { describe, expect, it } from 'vitest';
import { sessionSummaryLine } from './session-summary';

describe('sessionSummaryLine (TS4 — case-file per-session one-liner)', () => {
  it('prefers the note summary over assessment/plan for a treatment note', () => {
    const content = {
      summary:
        'Explored work stress; client identified two triggers and practised paced breathing.',
      assessment: 'Moderate anxiety, situational.',
      plan: 'Continue CBT; homework: thought record.',
    };
    expect(sessionSummaryLine('TREATMENT', content)).toBe(
      'Explored work stress; client identified two triggers and practised paced breathing.',
    );
  });

  it('falls back to assessment when a legacy note has no summary', () => {
    const content = { assessment: 'Improving mood, better sleep.', plan: 'Maintain plan.' };
    expect(sessionSummaryLine('TREATMENT', content)).toBe('Improving mood, better sleep.');
  });

  it('falls back to plan when neither summary nor assessment is present', () => {
    expect(sessionSummaryLine('TREATMENT', { plan: 'Weekly sessions, review in 6 weeks.' })).toBe(
      'Weekly sessions, review in 6 weeks.',
    );
  });

  it('uses presentingConcerns for an intake note (no summary field)', () => {
    const content = {
      presentingConcerns: 'Low mood and poor sleep for three months.',
      workingHypothesis: 'Major depressive episode, moderate.',
    };
    expect(sessionSummaryLine('INTAKE', content)).toBe('Low mood and poor sleep for three months.');
  });

  it('falls back to workingHypothesis for an intake note with no presenting concerns', () => {
    expect(sessionSummaryLine('INTAKE', { workingHypothesis: 'Adjustment disorder.' })).toBe(
      'Adjustment disorder.',
    );
  });

  it('collapses internal whitespace/newlines to single spaces', () => {
    expect(sessionSummaryLine('TREATMENT', { summary: 'line one\n\n  line   two' })).toBe(
      'line one line two',
    );
  });

  it('clamps an over-long field with an ellipsis', () => {
    const long = 'a'.repeat(400);
    const out = sessionSummaryLine('TREATMENT', { summary: long });
    expect(out).not.toBeNull();
    expect(out!.length).toBe(300);
    expect(out!.endsWith('…')).toBe(true);
  });

  it('returns null for empty / whitespace-only fields', () => {
    expect(
      sessionSummaryLine('TREATMENT', { summary: '   ', assessment: '', plan: '\n' }),
    ).toBeNull();
  });

  it('returns null defensively for non-object content', () => {
    expect(sessionSummaryLine('TREATMENT', null)).toBeNull();
    expect(sessionSummaryLine('TREATMENT', 'a string')).toBeNull();
    expect(sessionSummaryLine('TREATMENT', undefined)).toBeNull();
  });
});
