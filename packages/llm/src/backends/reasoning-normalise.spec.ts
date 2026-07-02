import { describe, expect, it } from 'vitest';
import { PassReasoningOutputSchema } from '../types';
import { normaliseReasoningOutput } from './reasoning-normalise';

describe('normaliseReasoningOutput', () => {
  it('maps likelihood/trend/priority/polarity drift to canonical values', () => {
    const raw = {
      findings: [
        {
          id: 'f1',
          kind: 'symptom',
          label: 'chest pain',
          utteranceIds: ['u1'],
          polarity: 'positive',
        },
      ],
      differential: [
        { id: 'd1', label: 'ACS', likelihood: 'medium', trend: 'increasing', evidenceFor: ['f1'] },
      ],
      askNext: [
        {
          id: 'q1',
          question: 'radiate?',
          why: 'ACS vs GERD',
          targetDxIds: ['d1'],
          priority: 'urgent',
        },
      ],
      redFlags: [],
    };
    const normalised = normaliseReasoningOutput(raw);
    // The normalised payload now parses cleanly under the strict schema.
    const parsed = PassReasoningOutputSchema.parse(normalised);
    expect(parsed.findings[0]!.polarity).toBe('present');
    expect(parsed.differential[0]!.likelihood).toBe('moderate');
    expect(parsed.differential[0]!.trend).toBe('up');
    expect(parsed.askNext[0]!.priority).toBe('high');
  });

  it('leaves canonical values untouched and passes through unknown shapes', () => {
    expect(normaliseReasoningOutput(null)).toBeNull();
    const canonical = {
      differential: [
        { id: 'd1', label: 'x', likelihood: 'high', trend: 'steady', evidenceFor: ['f1'] },
      ],
    };
    const out = normaliseReasoningOutput(canonical) as typeof canonical;
    expect(out.differential[0]!.likelihood).toBe('high');
    expect(out.differential[0]!.trend).toBe('steady');
  });

  it('does not rescue a genuinely unknown enum (Zod still rejects)', () => {
    const raw = {
      differential: [{ id: 'd1', label: 'x', likelihood: 'certain', evidenceFor: ['f1'] }],
    };
    const parsed = PassReasoningOutputSchema.safeParse(normaliseReasoningOutput(raw));
    expect(parsed.success).toBe(false);
  });
});
