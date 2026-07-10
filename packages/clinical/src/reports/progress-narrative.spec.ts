import { describe, expect, it } from 'vitest';
import { composeFocusSummary, modalityFocusPhrase } from './progress-narrative';

describe('modalityFocusPhrase', () => {
  it('maps known modalities to readable phrases', () => {
    expect(modalityFocusPhrase('CBT')).toBe('cognitive behavioural therapy');
    expect(modalityFocusPhrase('MI')).toBe('motivational interviewing');
  });
  it('returns null for unknown / absent modality', () => {
    expect(modalityFocusPhrase('YOGA')).toBeNull();
    expect(modalityFocusPhrase(null)).toBeNull();
    expect(modalityFocusPhrase(undefined)).toBeNull();
  });
});

describe('composeFocusSummary (TS4 — "what we worked on")', () => {
  it('weaves session count, modality, topics and goals into warm prose', () => {
    const out = composeFocusSummary({
      modalityLabel: 'cognitive behavioural therapy',
      sessionsCompleted: 6,
      topics: ['work stress', 'sleep', 'self-criticism'],
      goals: ['Sleep 7 hours a night', 'Return to regular exercise'],
    });
    expect(out).toBe(
      'Over 6 sessions of cognitive behavioural therapy, we focused on work stress, sleep and self-criticism. ' +
        'We kept your goals in view: Sleep 7 hours a night and Return to regular exercise.',
    );
  });

  it('caps topics at 3 and goals at 2', () => {
    const out = composeFocusSummary({
      modalityLabel: null,
      sessionsCompleted: 10,
      topics: ['stress', 'sleep', 'anger', 'money', 'family'],
      goals: ['goal-one', 'goal-two', 'goal-three'],
    });
    expect(out).toContain('we focused on stress, sleep and anger.');
    expect(out).not.toContain('money');
    expect(out).not.toContain('family');
    expect(out).toContain('your goals in view: goal-one and goal-two.');
    expect(out).not.toContain('goal-three');
  });

  it('de-duplicates topics case-insensitively, keeping first casing', () => {
    const out = composeFocusSummary({
      modalityLabel: null,
      sessionsCompleted: 3,
      topics: ['Anxiety', 'anxiety', 'ANXIETY', 'boundaries'],
      goals: [],
    });
    expect(out).toBe('Over 3 sessions, we focused on Anxiety and boundaries.');
  });

  it('uses the singular "session" for one session', () => {
    const out = composeFocusSummary({
      modalityLabel: null,
      sessionsCompleted: 1,
      topics: ['grief'],
      goals: [],
    });
    expect(out).toBe('Over 1 session, we focused on grief.');
  });

  it('falls back to a goals-only sentence when there are no topics', () => {
    const out = composeFocusSummary({
      modalityLabel: 'EMDR',
      sessionsCompleted: 4,
      topics: [],
      goals: ['Feel safe at home'],
    });
    expect(out).toBe(
      'Over 4 sessions of EMDR, we worked steadily toward your goals. We kept your goals in view: Feel safe at home.',
    );
  });

  it('handles zero sessions with a neutral lead', () => {
    const out = composeFocusSummary({
      modalityLabel: null,
      sessionsCompleted: 0,
      topics: ['first concerns'],
      goals: [],
    });
    expect(out).toBe('In our work together, we focused on first concerns.');
  });

  it('returns null when there is nothing to summarise', () => {
    expect(
      composeFocusSummary({ modalityLabel: 'CBT', sessionsCompleted: 5, topics: [], goals: [] }),
    ).toBeNull();
    expect(
      composeFocusSummary({
        modalityLabel: null,
        sessionsCompleted: 2,
        topics: ['   ', ''],
        goals: [' '],
      }),
    ).toBeNull();
  });
});
