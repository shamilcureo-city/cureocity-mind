import { describe, expect, it } from 'vitest';
import { normaliseDifferentialOutput } from './differential-normalise';
import { DifferentialDiagnosisV1Schema } from '@cureocity/contracts';

describe('normaliseDifferentialOutput', () => {
  it('flattens object red flags to strings (prod drift 2026-07-06)', () => {
    const raw = {
      version: 'V1',
      redFlagsToExclude: [
        { flag: 'Dengue haemorrhagic fever', rationale: 'fever in monsoon season' },
        { redFlag: 'Meningitis' },
        'Already a string',
      ],
    };
    const out = normaliseDifferentialOutput(raw) as { redFlagsToExclude: unknown[] };
    expect(out.redFlagsToExclude).toEqual([
      'Dengue haemorrhagic fever — fever in monsoon season',
      'Meningitis',
      'Already a string',
    ]);
  });

  it('lowercases INFO/WARNING severities and maps WARNING → warn', () => {
    const raw = {
      version: 'V1',
      codingNudges: [
        { message: 'a', severity: 'INFO' },
        { message: 'b', severity: 'WARNING' },
        { message: 'c', severity: 'warn' },
      ],
    };
    const out = normaliseDifferentialOutput(raw) as {
      codingNudges: Array<{ severity: string }>;
    };
    expect(out.codingNudges.map((n) => n.severity)).toEqual(['info', 'warn', 'warn']);
  });

  it('canonicalises drifted nudge kinds', () => {
    const raw = {
      version: 'V1',
      codingNudges: [{ message: 'a', kind: 'suggested-code', severity: 'info' }],
    };
    const out = normaliseDifferentialOutput(raw) as { codingNudges: Array<{ kind: string }> };
    expect(out.codingNudges[0]?.kind).toBe('SUGGESTED_CODE');
  });

  it('normalised prod-drift payload passes the Zod schema', () => {
    const raw = {
      version: 'V1',
      language: 'en',
      candidates: [],
      redFlagsToExclude: [{ flag: 'Sepsis', rationale: 'recent hospitalization' }],
      codingNudges: [{ message: 'Document fever duration', severity: 'INFO' }],
      disclaimer: 'Decision support only.',
    };
    const parsed = DifferentialDiagnosisV1Schema.safeParse(normaliseDifferentialOutput(raw));
    expect(parsed.success).toBe(true);
  });

  it('leaves unknown values for Zod to reject (no silent invention)', () => {
    const raw = { version: 'V1', codingNudges: [{ message: 'a', severity: 'catastrophic' }] };
    const out = normaliseDifferentialOutput(raw) as {
      codingNudges: Array<{ severity: string }>;
    };
    expect(out.codingNudges[0]?.severity).toBe('catastrophic');
  });

  it('is a no-op on already-canonical payloads and non-objects', () => {
    const canonical = { version: 'V1', redFlagsToExclude: ['x'], codingNudges: [] };
    expect(normaliseDifferentialOutput(canonical)).toEqual(canonical);
    expect(normaliseDifferentialOutput(null)).toBe(null);
    expect(normaliseDifferentialOutput('str')).toBe('str');
  });
});
