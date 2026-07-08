import { describe, expect, it } from 'vitest';
import { detectGaps } from './gaps';

/** RED_FLAG messages produced for a transcript (note omitted). */
function redFlags(transcript: string): string[] {
  return detectGaps(transcript, null)
    .filter((g) => g.kind === 'RED_FLAG')
    .map((g) => g.message);
}

describe('detectGaps — red flags', () => {
  it('DOC-8: routine BP / blood test / blood sugar talk raises NO bleeding flag', () => {
    // The exact alert-fatigue case: a hypertension + diabetes review.
    expect(redFlags('BP is 140/90, please order a blood test and check blood sugar')).toEqual([]);
    expect(redFlags('fasting blood glucose was high; repeat blood report next week')).toEqual([]);
    expect(redFlags('khoon ki jaanch karani hai')).toEqual([]); // "need a blood test"
  });

  it('DOC-8: genuine bleeding still raises the flag (en + code-mix)', () => {
    expect(redFlags('she is bleeding heavily since morning').join()).toMatch(/bleeding/i);
    expect(redFlags('there is blood in the stool').join()).toMatch(/bleeding/i);
    expect(redFlags('patient coughing up blood').join()).toMatch(/bleeding/i);
    expect(redFlags('khoon aa raha hai').join()).toMatch(/bleeding/i); // "blood is coming"
  });

  it('flags chest pain (en + Hinglish) without the mojibake pattern', () => {
    expect(redFlags('complains of chest pain on exertion').join()).toMatch(/chest pain/i);
    expect(redFlags('seene mein dard ho raha hai').join()).toMatch(/chest pain/i);
  });

  it('flags breathlessness and syncope', () => {
    expect(redFlags('feeling short of breath').join()).toMatch(/breathless/i);
    expect(redFlags('he fainted and was unconscious briefly').join()).toMatch(/syncope|red flag/i);
  });

  it('a clean routine consult produces no red flags at all', () => {
    expect(redFlags('here for a routine diabetes follow up, feeling well, no complaints')).toEqual(
      [],
    );
  });
});
