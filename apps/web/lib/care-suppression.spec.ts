import { describe, expect, it } from 'vitest';
import { evaluateCareSuppression, isMoodDeclining } from './care-suppression';

/**
 * CG3 — the suppression invariants (docs/CARE_GROWTH_SYSTEM.md §9 #2).
 * These are the ethics charter as executable assertions: every commerce/
 * share/gift/trial surface calls this ONE function, and these cases pin
 * the behaviours a drifted per-surface predicate would lose.
 */

const NOW = new Date('2026-08-26T12:00:00Z');

const CALM = {
  status: 'ACTIVE' as const,
  safetyHoldAt: null,
  lastCrisisAt: null,
  latestRiskLevel: 'LOW' as const,
  worseningVerdict: false,
  recentMoods: [6, 5, 6, 5, 6, 5],
  now: NOW,
};

describe('evaluateCareSuppression', () => {
  it('allows commerce for a calm, active account', () => {
    expect(evaluateCareSuppression(CALM)).toEqual({ suppress: false, reasons: [] });
  });

  it('suppresses on SAFETY_HOLD status', () => {
    const v = evaluateCareSuppression({ ...CALM, status: 'SAFETY_HOLD' });
    expect(v.suppress).toBe(true);
    expect(v.reasons).toContain('account_not_active');
  });

  it('suppresses for 7 days after a lifted hold (the hold timestamp lingers)', () => {
    const v = evaluateCareSuppression({
      ...CALM,
      safetyHoldAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    });
    expect(v.suppress).toBe(true);
    expect(v.reasons).toContain('safety_hold_within_7d');
  });

  it('stops suppressing once the hold is older than 7 days', () => {
    const v = evaluateCareSuppression({
      ...CALM,
      safetyHoldAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000),
    });
    expect(v.suppress).toBe(false);
  });

  it('suppresses within 7 days of a crisis event', () => {
    const v = evaluateCareSuppression({
      ...CALM,
      lastCrisisAt: new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000),
    });
    expect(v.suppress).toBe(true);
    expect(v.reasons).toContain('crisis_within_7d');
  });

  it('suppresses on a MODERATE risk screen — the drift gap the ethics critique found', () => {
    const v = evaluateCareSuppression({ ...CALM, latestRiskLevel: 'MODERATE' });
    expect(v.suppress).toBe(true);
    expect(v.reasons).toContain('risk_screen_above_low');
  });

  it('suppresses on HIGH risk and on worsening verdicts', () => {
    expect(evaluateCareSuppression({ ...CALM, latestRiskLevel: 'HIGH' }).suppress).toBe(true);
    expect(evaluateCareSuppression({ ...CALM, worseningVerdict: true }).suppress).toBe(true);
  });

  it('suppresses on a clearly declining mood series', () => {
    const v = evaluateCareSuppression({ ...CALM, recentMoods: [2, 3, 2, 6, 5, 6] });
    expect(v.suppress).toBe(true);
    expect(v.reasons).toContain('mood_declining');
  });

  it('treats NONE and null risk levels as calm', () => {
    expect(evaluateCareSuppression({ ...CALM, latestRiskLevel: 'NONE' }).suppress).toBe(false);
    expect(evaluateCareSuppression({ ...CALM, latestRiskLevel: null }).suppress).toBe(false);
  });

  it('collects every active reason (an auditable explanation, not a bare flag)', () => {
    const v = evaluateCareSuppression({
      ...CALM,
      status: 'SAFETY_HOLD',
      latestRiskLevel: 'HIGH',
      worseningVerdict: true,
    });
    expect(v.reasons).toEqual(
      expect.arrayContaining(['account_not_active', 'risk_screen_above_low', 'worsening_verdict']),
    );
  });
});

describe('isMoodDeclining', () => {
  it('needs at least 6 points', () => {
    expect(isMoodDeclining([1, 2, 3])).toBe(false);
  });
  it('flags a 1.5+ average drop across the two windows', () => {
    expect(isMoodDeclining([3, 3, 3, 5, 5, 5])).toBe(true);
  });
  it('ignores noise smaller than the threshold', () => {
    expect(isMoodDeclining([5, 4, 5, 5, 6, 5])).toBe(false);
  });
});
