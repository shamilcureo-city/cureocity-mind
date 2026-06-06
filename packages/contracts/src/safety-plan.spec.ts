import { describe, expect, it } from 'vitest';
import { SafetyPlanV1Schema, type SafetyPlanV1 } from './safety-plan';

describe('SafetyPlanV1Schema', () => {
  const valid: SafetyPlanV1 = {
    version: 'V1',
    language: 'en',
    warningSigns: ['Sleepless 3 nights in a row', 'Withdrawing from family'],
    internalCoping: ['10 minutes of slow breathing', 'Walk around the colony'],
    socialDistractions: [{ name: 'Sister-in-law Priya', contact: '+91 9812345678' }],
    helpContacts: [{ name: 'Friend Arjun', relationship: 'best friend', contact: '+91 9123456789' }],
    professionals: [{ name: 'iCall', contact: '9152987821', availability: 'Mon-Sat 8am-10pm' }],
  };

  it('accepts a representative plan', () => {
    expect(SafetyPlanV1Schema.safeParse(valid).success).toBe(true);
  });

  it('requires at least one entry per Stanley & Brown section', () => {
    expect(
      SafetyPlanV1Schema.safeParse({ ...valid, warningSigns: [] }).success,
    ).toBe(false);
    expect(
      SafetyPlanV1Schema.safeParse({ ...valid, internalCoping: [] }).success,
    ).toBe(false);
    expect(
      SafetyPlanV1Schema.safeParse({ ...valid, socialDistractions: [] }).success,
    ).toBe(false);
    expect(SafetyPlanV1Schema.safeParse({ ...valid, helpContacts: [] }).success).toBe(false);
    expect(SafetyPlanV1Schema.safeParse({ ...valid, professionals: [] }).success).toBe(false);
  });

  it('accepts an optional means-restriction note', () => {
    expect(
      SafetyPlanV1Schema.safeParse({
        ...valid,
        meansRestriction: 'Medication stored with spouse for the next 2 weeks.',
      }).success,
    ).toBe(true);
  });

  it('caps each section at 8 entries', () => {
    const tooMany = Array.from({ length: 9 }, (_, i) => `warning ${i}`);
    expect(
      SafetyPlanV1Schema.safeParse({ ...valid, warningSigns: tooMany }).success,
    ).toBe(false);
  });
});
