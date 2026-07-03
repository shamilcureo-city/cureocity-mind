import { describe, expect, it } from 'vitest';
import {
  AskNextItemSchema,
  LiveDifferentialItemSchema,
  LiveReasoningSchema,
  LiveRedFlagSchema,
} from './live-reasoning';

describe('LiveDifferentialItemSchema', () => {
  it('defaults trend/urgent/evidence and requires likelihood', () => {
    const d = LiveDifferentialItemSchema.parse({
      id: 'd1',
      label: 'Unstable angina',
      likelihood: 'high',
    });
    expect(d.trend).toBe('new');
    expect(d.urgent).toBe(false);
    expect(d.evidenceFor).toEqual([]);
    expect(d.evidenceAgainst).toEqual([]);
  });

  it('rejects an unknown likelihood', () => {
    expect(
      LiveDifferentialItemSchema.safeParse({ id: 'd1', label: 'x', likelihood: 'certain' }).success,
    ).toBe(false);
  });

  it('carries icd10 + discriminator when present', () => {
    const d = LiveDifferentialItemSchema.parse({
      id: 'd1',
      label: 'Unstable angina',
      icd10: 'I20.0',
      likelihood: 'high',
      urgent: true,
      evidenceFor: ['f1'],
      discriminator: 'troponin + serial ECG',
    });
    expect(d.icd10).toBe('I20.0');
    expect(d.urgent).toBe(true);
    expect(d.discriminator).toContain('troponin');
  });
});

describe('AskNextItemSchema', () => {
  it('defaults source/priority/status', () => {
    const a = AskNextItemSchema.parse({
      id: 'q1',
      question: 'Radiates to arm?',
      why: 'ACS vs GERD',
    });
    expect(a.source).toBe('DIFFERENTIAL');
    expect(a.priority).toBe('normal');
    expect(a.status).toBe('open');
    expect(a.targetDxIds).toEqual([]);
  });
});

describe('LiveReasoningSchema', () => {
  it('parses an empty snapshot with defaults', () => {
    const r = LiveReasoningSchema.parse({});
    expect(r.differential).toEqual([]);
    expect(r.askNext).toEqual([]);
    expect(r.redFlags).toEqual([]);
    expect(r.version).toBe(0);
  });

  it('parses a populated snapshot', () => {
    const r = LiveReasoningSchema.parse({
      differential: [{ id: 'd1', label: 'ACS', likelihood: 'high', evidenceFor: ['f1'] }],
      askNext: [{ id: 'q1', question: 'Radiates?', why: 'ACS vs GERD', targetDxIds: ['d1'] }],
      redFlags: [{ label: 'ACS', why: 'exclude with ECG + troponin', findingIds: ['f1'] }],
      version: 3,
    });
    expect(r.differential[0]!.id).toBe('d1');
    expect(r.version).toBe(3);
  });
});

describe('LiveRedFlagSchema', () => {
  it('defaults findingIds', () => {
    const f = LiveRedFlagSchema.parse({ label: 'ACS', why: 'exclude' });
    expect(f.findingIds).toEqual([]);
  });
});
