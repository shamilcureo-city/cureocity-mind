import { describe, expect, it } from 'vitest';
import { PlanDictationV1Schema } from '@cureocity/contracts';
import { normalisePlanDictationOutput } from './plan-dictation-normalise';

describe('normalisePlanDictationOutput', () => {
  it('passes canonical output through and parses', () => {
    const raw = {
      edits: [
        { action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' },
        { action: 'setFollowUp', when: 'In 2 weeks' },
      ],
      clarifications: ['Atorvastatin 20 — at night?'],
    };
    const parsed = PlanDictationV1Schema.parse(normalisePlanDictationOutput(raw));
    expect(parsed.edits).toHaveLength(2);
    expect(parsed.clarifications).toEqual(['Atorvastatin 20 — at night?']);
  });

  it('maps action synonyms + drift keys to canonical shapes', () => {
    const raw = {
      commands: [
        { op: 'update_med', medication: 'Amlodipine', strength: 10 },
        { type: 'orderTest', test: 'Lipid profile' },
        { action: 'stopMed', med: 'Aspirin' },
        { action: 'follow_up', when: 'In 3 days' },
      ],
    };
    const parsed = PlanDictationV1Schema.parse(normalisePlanDictationOutput(raw));
    expect(parsed.edits).toEqual([
      { action: 'changeMed', drug: 'Amlodipine', strength: '10' },
      { action: 'addInvestigation', name: 'Lipid profile' },
      { action: 'removeMed', drug: 'Aspirin' },
      { action: 'setFollowUp', when: 'In 3 days' },
    ]);
  });

  it('accepts a bare top-level array of edits', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput([{ action: 'removeInvestigation', name: 'ECG' }]),
    );
    expect(parsed.edits).toHaveLength(1);
  });

  it('coerces durationDays drift ("5 days", "2 weeks", "3 months", floats)', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput({
        edits: [
          { action: 'addMed', drug: 'A', durationDays: '5 days' },
          { action: 'addMed', drug: 'B', duration: '2 weeks' },
          { action: 'addMed', drug: 'C', days: 3.4 },
          { action: 'addMed', drug: 'D', duration: '3 months' },
        ],
      }),
    );
    expect(parsed.edits.map((e) => (e as { durationDays?: number }).durationDays)).toEqual([
      5, 14, 3, 90,
    ]);
  });

  it('drops the duration (not the edit) on an unrecognised unit', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput({
        edits: [{ action: 'addMed', drug: 'A', duration: '2 fortnights' }],
      }),
    );
    expect(parsed.edits[0]).toEqual({ action: 'addMed', drug: 'A' });
  });

  it('drops malformed edits with an honest clarification instead of failing everything', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput({
        edits: [
          { action: 'renameMed', drug: 'X' }, // unknown action
          { action: 'removeMed' }, // missing target
          { action: 'addAdvice', text: 'Rest for 2 days' }, // fine
        ],
      }),
    );
    expect(parsed.edits).toEqual([{ action: 'addAdvice', text: 'Rest for 2 days' }]);
    expect(parsed.clarifications).toHaveLength(1);
    expect(parsed.clarifications[0]).toContain('2 edits dropped');
  });

  it('clips overlong strings to the schema caps instead of failing', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput({
        edits: [{ action: 'addMed', drug: 'X'.repeat(500), strength: 'y'.repeat(200) }],
      }),
    );
    const med = parsed.edits[0] as { drug: string; strength?: string };
    expect(med.drug).toHaveLength(120);
    expect(med.strength).toHaveLength(60);
  });

  it('coerces object-shaped clarifications and caps the list', () => {
    const parsed = PlanDictationV1Schema.parse(
      normalisePlanDictationOutput({
        edits: [],
        clarifications: [{ question: 'Which statin?' }, '', 42],
      }),
    );
    expect(parsed.clarifications).toEqual(['Which statin?']);
  });

  it('is idempotent', () => {
    const raw = {
      edits: [{ action: 'changeMed', drug: 'Amlodipine', strength: '10 mg' }],
      clarifications: [],
    };
    const once = normalisePlanDictationOutput(raw);
    expect(normalisePlanDictationOutput(once)).toEqual(once);
  });
});
