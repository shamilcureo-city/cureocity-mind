import { describe, expect, it } from 'vitest';
import { collectNoteText, indicScriptRatio, noteNeedsEnglishTranslation } from './language-detect';

describe('indicScriptRatio', () => {
  it('is 0 for pure English', () => {
    expect(indicScriptRatio('The client reported low mood and poor sleep.')).toBe(0);
  });
  it('is ~1 for pure Malayalam', () => {
    expect(indicScriptRatio('ക്ലയന്റ് കുറഞ്ഞ മാനസികാവസ്ഥ റിപ്പോർട്ട് ചെയ്തു')).toBeGreaterThan(0.9);
  });
  it('is 0 for a string with no letters (numbers/punctuation)', () => {
    expect(indicScriptRatio('123 — 4/5 (6).')).toBe(0);
  });
  it('counts the non-Latin fraction for code-mixed text', () => {
    // Roughly half Malayalam, half English letters.
    const r = indicScriptRatio('anxiety ഉണ്ട്');
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.8);
  });
});

describe('collectNoteText — skips linkedEvidence quotes', () => {
  it('gathers clinician fields but not verbatim quotes / metadata', () => {
    const note = {
      version: 'V1',
      modality: 'CBT',
      subjective: 'Client reports anxiety.',
      assessment: 'Moderate GAD.',
      riskFlags: { severity: 'low', indicators: ['worry'] },
      linkedEvidence: [{ quote: 'എനിക്ക് ആശങ്ക ഉണ്ട്', startMs: 1000 }],
    };
    const texts = collectNoteText(note);
    expect(texts).toContain('Client reports anxiety.');
    expect(texts).toContain('Moderate GAD.');
    expect(texts).toContain('worry');
    // The verbatim Malayalam quote + version/modality are excluded.
    expect(texts.join(' ')).not.toContain('ആശങ്ക');
    expect(texts).not.toContain('V1');
    expect(texts).not.toContain('CBT');
  });
});

describe('noteNeedsEnglishTranslation', () => {
  it('is false for an English note (even with a Malayalam evidence quote)', () => {
    const note = {
      subjective: 'Client reports low mood and poor sleep for three weeks.',
      assessment: 'Moderate depressive episode; monitor risk.',
      plan: 'Weekly CBT; PHQ-9 next visit.',
      linkedEvidence: [{ quote: 'എനിക്ക് ഉറക്കമില്ല', startMs: 500 }],
    };
    expect(noteNeedsEnglishTranslation(note)).toBe(false);
  });

  it('is TRUE for a note written in Malayalam (the reported bug)', () => {
    const note = {
      presentingConcerns: 'ക്ലയന്റ് പൂർണ്ണമായും നെഗറ്റീവ് ആയ അമിതമായ ചിന്ത റിപ്പോർട്ട് ചെയ്യുന്നു.',
      workingHypothesis: 'വിഷാദരോഗം സംശയിക്കുന്നു.',
      immediatePlan: 'അടുത്ത സെഷൻ ഷെഡ്യൂൾ ചെയ്യുക.',
    };
    expect(noteNeedsEnglishTranslation(note)).toBe(true);
  });

  it('is TRUE for a Hindi (Devanagari) note', () => {
    const note = { subjective: 'क्लाइंट ने चिंता और नींद की समस्या बताई।' };
    expect(noteNeedsEnglishTranslation(note)).toBe(true);
  });

  it('is false for an empty note', () => {
    expect(noteNeedsEnglishTranslation({})).toBe(false);
  });
});
