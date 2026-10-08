import { describe, expect, it } from 'vitest';
import {
  MEDICAL_TRANSCRIBE_PROMPT_VERSION,
  MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2,
  TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION,
  TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1,
  transcribePromptFor,
} from './index';

// DOC-6 — the doctor vertical must transcribe with the medical scribe prompt,
// not the psychotherapy one. These lock the selection + the medical prompt's
// defining properties so a future edit can't silently regress it to the
// therapy persona (the exact drift this finding fixed).
describe('transcribePromptFor (DOC-6)', () => {
  it('selects the medical prompt + version for DOCTOR', () => {
    const picked = transcribePromptFor('DOCTOR');
    expect(picked.prompt).toBe(MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2);
    expect(picked.version).toBe(MEDICAL_TRANSCRIBE_PROMPT_VERSION);
    expect(picked.version).toBe('MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V4');
  });

  // TS-fix — both prompts must instruct the model to return an EMPTY result on
  // silence rather than hallucinating dialogue (the "it invents things when I
  // don't talk" bug). Lock it so a future edit can't silently drop it.
  it('both transcribe prompts forbid hallucinating on silence', () => {
    for (const p of [
      MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2,
      TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1,
    ]) {
      expect(p).toMatch(/NO SPEECH/);
      expect(p).toMatch(/NEVER invent/i);
      expect(p).toMatch(/transcript:\s*""/);
    }
  });

  it('selects the psychotherapy prompt + version for THERAPIST', () => {
    const picked = transcribePromptFor('THERAPIST');
    expect(picked.prompt).toBe(TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1);
    expect(picked.version).toBe(TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION);
  });

  it('the medical prompt is real, not a placeholder stub', () => {
    expect(MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2).not.toMatch(/PLACEHOLDER/i);
    // Substantially longer than the old one-line stub.
    expect(MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2.length).toBeGreaterThan(800);
  });

  it('preserves actual drug names and dosing without supplying patient-like examples', () => {
    const p = MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2;
    expect(p).toMatch(/drug names/i);
    expect(p).toMatch(/frequency shorthand, duration and route exactly\s+as spoken/);
    expect(p).toMatch(/Vitals and labs with their numbers and units exactly as spoken/);
    for (const example of [
      'sugar high hai',
      'Glycomet',
      'metformin',
      'Telma',
      'telmisartan',
      'Aspirin',
      'atorvastatin',
      '500 mg',
      '1-0-1',
      'x5 days',
      '130/80',
      'PR 88',
      'SpO2 97%',
      'HbA1c 7.2',
      'FBS 140',
      'creatinine 1.1',
    ]) {
      expect(p).not.toContain(example);
    }
    expect(p).toMatch(/Native scripts are preferred/);
    expect(p).toMatch(/Every transcript word must come from this audio/);
  });

  it('the medical prompt skips affect features (empty array), unlike therapy', () => {
    // Medical: explicitly instructs an EMPTY affectFeatures array.
    expect(MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2).toMatch(/affectFeatures:\s*\[\]/);
    // Therapy: still samples affect at ~30s intervals.
    expect(TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1).toMatch(/affectFeatures/);
    expect(TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1).toMatch(/30s/);
  });

  it('the medical prompt uses the pipeline speaker slots (therapist/client)', () => {
    // The Pass1Output schema enum is therapist|client|unknown; the medical
    // prompt maps doctor→therapist slot + patient→client slot so it stays
    // schema-valid (the app remaps for display).
    const p = MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2;
    expect(p).toContain('"therapist"');
    expect(p).toContain('"client"');
    expect(p).toMatch(/DOCTOR/);
    expect(p).toMatch(/PATIENT/);
  });
});
