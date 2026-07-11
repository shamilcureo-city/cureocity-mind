import { describe, expect, it } from 'vitest';
import { evaluateCareGate } from './care-gate';

const base = {
  status: 'ACTIVE' as const,
  onboardedAt: new Date('2026-07-01'),
  planTier: 'free',
  sessionsThisWeek: 0,
};

describe('evaluateCareGate', () => {
  it('allows an onboarded active user under the cap', () => {
    expect(evaluateCareGate(base)).toEqual({ allowed: true, code: 'OK' });
  });

  it('blocks a safety hold with a plain-words reason', () => {
    const v = evaluateCareGate({ ...base, status: 'SAFETY_HOLD' });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe('SAFETY_HOLD');
    expect(v.reason).toBeTruthy();
  });

  it('blocks before onboarding', () => {
    const v = evaluateCareGate({ ...base, onboardedAt: null });
    expect(v.code).toBe('NOT_ONBOARDED');
  });

  it('enforces the free-tier weekly cap', () => {
    expect(evaluateCareGate({ ...base, sessionsThisWeek: 1 }).allowed).toBe(true);
    const v = evaluateCareGate({ ...base, sessionsThisWeek: 2 });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe('WEEKLY_CAP');
  });

  it('gives plus tier a higher cap and unknown tiers the free cap', () => {
    expect(evaluateCareGate({ ...base, planTier: 'plus', sessionsThisWeek: 5 }).allowed).toBe(true);
    expect(evaluateCareGate({ ...base, planTier: 'mystery', sessionsThisWeek: 2 }).allowed).toBe(
      false,
    );
  });

  it('safety hold outranks every other verdict', () => {
    const v = evaluateCareGate({
      ...base,
      status: 'SAFETY_HOLD',
      onboardedAt: null,
      sessionsThisWeek: 99,
    });
    expect(v.code).toBe('SAFETY_HOLD');
  });

  it('deleted accounts are blocked outright', () => {
    expect(evaluateCareGate({ ...base, status: 'DELETED' }).code).toBe('DELETED');
  });
});
