import { describe, expect, it } from 'vitest';
import { summarizeMindSessionNote } from './mind-session-note-summary';

const intake = {
  presentingConcerns: 'Fictional concern',
  historyOfPresentingIllness: 'Fictional onset and course',
  workingHypothesis: 'A clinician hypothesis, not a diagnosis',
  immediatePlan: 'An agreed follow-up',
};
const soap = {
  subjective: 'Client report',
  assessment: 'Clinician assessment',
  plan: 'Agreed plan',
};

describe('canonical Mind note summaries', () => {
  it('includes all four intake fields, without recasting the hypothesis as confirmed diagnosis', () => {
    expect(
      summarizeMindSessionNote({
        kind: 'INTAKE',
        therapyNote: { content: intake },
        noteDraft: null,
      }),
    ).toBe(
      'Presenting concerns: Fictional concern | History: Fictional onset and course | Working hypothesis: A clinician hypothesis, not a diagnosis | Immediate plan: An agreed follow-up',
    );
  });
  it('uses the signed/revised note rather than a stale draft', () => {
    const result = summarizeMindSessionNote({
      kind: 'INTAKE',
      therapyNote: { content: intake },
      noteDraft: { content: { ...intake, immediatePlan: 'Stale draft plan' } },
    });
    expect(result).toContain('An agreed follow-up');
    expect(result).not.toContain('Stale draft');
  });
  it('supports legacy intake rows without a kind and unsigned intake drafts', () => {
    expect(
      summarizeMindSessionNote({ therapyNote: null, noteDraft: { content: intake } }),
    ).toContain('Working hypothesis:');
  });
  it.each(['TREATMENT', 'REVIEW'])('retains the canonical SOAP fields for %s', (kind) => {
    expect(
      summarizeMindSessionNote({ kind, therapyNote: { content: soap }, noteDraft: null }),
    ).toBe('S: Client report | A: Clinician assessment | P: Agreed plan');
  });
  it('ignores template renderings and clips only the canonical fields', () => {
    const result = summarizeMindSessionNote(
      {
        therapyNote: {
          content: {
            ...soap,
            subjective: 'abcdefgh',
            templateSections: [{ title: 'S', body: 'wrong' }],
          },
        },
        noteDraft: null,
      },
      4,
    );
    expect(result).toBe('S: abcd… | A: Clin… | P: Agre…');
  });
  it('does not invent history for missing or malformed content', () => {
    expect(summarizeMindSessionNote(null)).toBeNull();
    expect(
      summarizeMindSessionNote({
        therapyNote: { content: { subjective: 4, plan: '' } },
        noteDraft: null,
      }),
    ).toBeNull();
  });
});
