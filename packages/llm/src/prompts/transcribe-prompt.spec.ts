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
    expect(picked.version).toBe('MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2');
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

  it('the medical prompt biases drug names + dosing shorthand', () => {
    const p = MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2;
    expect(p).toMatch(/drug names/i);
    // Dosing frequency shorthand kept verbatim.
    for (const token of ['OD', 'BD', 'TDS', 'SOS', 'PRN']) {
      expect(p).toContain(token);
    }
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
