import { describe, expect, it } from 'vitest';
import { composeLetter, type LetterContext } from './letter';

const base: LetterContext = {
  clientFullName: 'Arjun Rao',
  therapistFullName: 'Dr Priya Menon',
  rciNumber: 'RCI-12345',
  diagnosis: { icd11Code: '6A70.1', icd11Label: 'Single episode depressive disorder, moderate' },
  presentingConcerns: 'low mood, poor sleep, loss of interest',
  completedSessions: 8,
  firstSessionAt: '2026-04-01T10:00:00.000Z',
  lastSessionAt: '2026-06-20T10:00:00.000Z',
  treatmentFocus: 'cognitive behavioural therapy',
  instrumentTrajectory: [],
  note: null,
};

describe('composeLetter — TS4 clinical-reasoning uplift', () => {
  it('REFERRAL folds in diagnosis, focus and a session span', () => {
    const { subject, body } = composeLetter('REFERRAL', base);
    expect(subject).toBe('Referral — Arjun Rao');
    expect(body).toContain('8 psychotherapy sessions between 01 Apr 2026 and 20 Jun 2026');
    expect(body).toContain('ICD-11 6A70.1');
    expect(body).toContain('The therapeutic work has focused on cognitive behavioural therapy.');
  });

  it('REFERRAL states a clinical RESPONSE with the % reduction', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      instrumentTrajectory: [
        { instrumentKey: 'PHQ9', baselineScore: 20, latestScore: 8, administrationCount: 3 },
      ],
    }).body;
    expect(body).toContain('PHQ-9 score has fallen from 20 to 8');
    expect(body).toContain('60% reduction');
    expect(body).toContain('clinical response');
    // A responder gets the standard (not "limited response") rationale.
    expect(body).toContain('your view on whether pharmacological management');
    expect(body).not.toContain('limited symptomatic response');
  });

  it('REFERRAL states REMISSION when the latest score is within range', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      instrumentTrajectory: [
        { instrumentKey: 'GAD7', baselineScore: 16, latestScore: 3, administrationCount: 4 },
      ],
    }).body;
    expect(body).toContain('GAD-7 score has fallen from 16 to 3');
    expect(body).toContain('remission of anxiety symptoms');
    expect(body).not.toContain('limited symptomatic response');
  });

  it('REFERRAL flips to the limited-response rationale when symptoms persist', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      instrumentTrajectory: [
        { instrumentKey: 'PHQ9', baselineScore: 14, latestScore: 12, administrationCount: 3 },
      ],
    }).body;
    expect(body).toContain('partial improvement');
    expect(body).toContain('has not yet reached the threshold for a reliable response');
    expect(body).toContain('Given the limited symptomatic response to psychological therapy alone');
  });

  it('REFERRAL reports a worsening trajectory', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      instrumentTrajectory: [
        { instrumentKey: 'PHQ9', baselineScore: 8, latestScore: 15, administrationCount: 2 },
      ],
    }).body;
    expect(body).toContain('PHQ-9 score has risen from 8 to 15');
    expect(body).toContain('worsening');
    expect(body).toContain('Given the limited symptomatic response');
  });

  it('REFERRAL without a trajectory omits scores but keeps focus + standard rationale', () => {
    const body = composeLetter('REFERRAL', { ...base, instrumentTrajectory: [] }).body;
    expect(body).toContain('The therapeutic work has focused on cognitive behavioural therapy.');
    expect(body).not.toMatch(/PHQ-9|GAD-7/);
    expect(body).toContain('your view on whether pharmacological management');
  });

  it('ATTENDANCE discloses NO clinical information (no diagnosis, no scores, no focus)', () => {
    const body = composeLetter('ATTENDANCE', {
      ...base,
      instrumentTrajectory: [
        { instrumentKey: 'PHQ9', baselineScore: 20, latestScore: 8, administrationCount: 3 },
      ],
    }).body;
    expect(body).toContain('No clinical information is disclosed.');
    expect(body).not.toMatch(/PHQ-9|GAD-7/);
    expect(body).not.toContain('ICD-11');
    expect(body).not.toContain('cognitive behavioural therapy');
  });

  it('SUPPORT / FITNESS carry the focus but never symptom scores', () => {
    const traj = [
      { instrumentKey: 'PHQ9' as const, baselineScore: 20, latestScore: 8, administrationCount: 3 },
    ];
    for (const kind of ['SUPPORT', 'FITNESS'] as const) {
      const body = composeLetter(kind, { ...base, instrumentTrajectory: traj }).body;
      expect(body).toContain('cognitive behavioural therapy');
      expect(body).not.toMatch(/PHQ-9|GAD-7/);
    }
  });

  it('uses the singular "session" and omits the diagnosis line when absent', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      completedSessions: 1,
      firstSessionAt: '2026-06-20T10:00:00.000Z',
      lastSessionAt: '2026-06-20T10:00:00.000Z',
      diagnosis: null,
    }).body;
    expect(body).toContain('1 psychotherapy session, beginning 20 Jun 2026');
    expect(body).not.toContain('ICD-11');
  });

  it('appends the therapist free-text note before the sign-off', () => {
    const body = composeLetter('REFERRAL', {
      ...base,
      note: 'Please contact me on Tuesdays.',
    }).body;
    expect(body).toContain('Please contact me on Tuesdays.');
    expect(body.trim().endsWith('Yours sincerely,')).toBe(true);
  });
});
