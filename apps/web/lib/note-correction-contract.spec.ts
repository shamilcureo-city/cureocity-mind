import { describe, expect, it } from 'vitest';
import { ReviseNoteInputSchema } from '@cureocity/contracts';

describe('vertical-aware signed note correction contract', () => {
  it('accepts a medical correction with medical signable fields', () => {
    expect(
      ReviseNoteInputSchema.safeParse({
        kind: 'MEDICAL',
        chiefComplaint: 'Updated complaint',
        hpi: 'Updated HPI',
        assessment: 'Updated assessment',
        plan: 'Updated plan',
        reason: 'Correcting dictated details',
      }).success,
    ).toBe(true);
  });

  it('keeps therapy corrections on the existing SOAP branch', () => {
    expect(
      ReviseNoteInputSchema.safeParse({
        kind: 'TREATMENT',
        subjective: 'Updated subjective',
        reason: 'Correcting patient wording',
      }).success,
    ).toBe(true);
  });
});
