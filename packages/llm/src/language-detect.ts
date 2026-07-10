/**
 * Sprint TS-fix — deterministic "is this note in the wrong language?" detector.
 *
 * The therapist-facing note is meant to be the clinician's ENGLISH record. Pass
 * 2 is prompted to translate any non-English transcript to English, but a
 * heavily code-mixed / Malayalam-dominant transcript can make the model echo
 * the source language anyway. This module lets the note pipeline notice that
 * deterministically and repair it (auto-translate) before the note is ever
 * shown — so a human never sees a note in a language they didn't ask for.
 *
 * Pure + dependency-free so it is unit-tested without a model.
 */

// Unicode blocks for the Indic scripts real Indian sessions use: Devanagari
// (Hindi/Marathi), Bengali, Gurmukhi (Punjabi), Gujarati, Oriya, Tamil,
// Telugu, Kannada, Malayalam.
const INDIC_SCRIPT = /[ऀ-෿]/gu;

/** Fraction (0..1) of a text's LETTERS that are in a non-Latin Indic script. */
export function indicScriptRatio(text: string): number {
  const letters = text.match(/\p{L}/gu);
  if (!letters || letters.length === 0) return 0;
  const indic = text.match(INDIC_SCRIPT);
  return (indic?.length ?? 0) / letters.length;
}

/**
 * Collect the clinician-facing string values of a note, SKIPPING keys whose
 * content is intentionally kept in the original language — `linkedEvidence`
 * (verbatim client quotes) and its `quote` fields. Walks the note JSON so it
 * works for both TherapyNoteV1 and IntakeNoteV1 without knowing their shapes.
 */
export function collectNoteText(note: unknown): string[] {
  const out: string[] = [];
  const skipKeys = new Set(['linkedEvidence', 'quote', 'startMs', 'endMs', 'version', 'modality']);
  const walk = (value: unknown, key?: string): void => {
    if (key !== undefined && skipKeys.has(key)) return;
    if (typeof value === 'string') {
      if (value.trim().length > 0) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(note);
  return out;
}

/**
 * True when the note's clinician-facing text is substantially in a non-English
 * Indic script (so it should be translated to English before display). The
 * default 0.15 threshold tolerates the odd native-script term inside an
 * otherwise-English note while catching a note that is actually written in
 * Malayalam/Hindi/etc.
 */
export function noteNeedsEnglishTranslation(note: unknown, threshold = 0.15): boolean {
  const combined = collectNoteText(note).join(' ');
  return indicScriptRatio(combined) >= threshold;
}
