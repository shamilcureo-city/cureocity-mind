import { describe, expect, it } from 'vitest';
import * as prompts from './index';

const runtimeStrings = Object.entries(prompts).filter(
  (entry): entry is [string, string] =>
    typeof entry[1] === 'string' && !entry[0].endsWith('_VERSION'),
);

describe('runtime prompt hygiene', () => {
  it('covers every exported prompt string, including both transcription verticals', () => {
    expect(runtimeStrings.length).toBeGreaterThanOrEqual(19);
    expect(runtimeStrings.map(([name]) => name)).toContain(
      'TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1',
    );
    expect(runtimeStrings.map(([name]) => name)).toContain('MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V2');
    expect(runtimeStrings.map(([name]) => name)).toContain('CARE_REPORT_SYSTEM_PROMPT_V1');
  });

  it.each(runtimeStrings)(
    '%s does not send development approval instructions to a model',
    (_, text) => {
      expect(text).not.toMatch(/PLACEHOLDER|replace verbatim per PRD|pending .{0,80}sign[- ]off/i);
    },
  );

  it.each(['INTAKE', 'TREATMENT', 'REVIEW'] as const)(
    'also checks the generated Care %s system prompt',
    (kind) => {
      const text = prompts.buildCareTherapistPrompt({
        kind,
        personaName: 'Fictional guide',
        personaStyle: 'gentle',
        userFirstName: 'Test',
        languageGuidance: 'Use the spoken language.',
        sessionCapMin: 10,
      });
      expect(text).not.toMatch(/PLACEHOLDER|replace verbatim per PRD|pending .{0,80}sign[- ]off/i);
    },
  );

  it('advances all sixteen changed prompt versions without changing untouched ones', () => {
    expect(prompts).toMatchObject({
      TRANSCRIBE_AND_ANALYSE_PROMPT_VERSION: 'TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V4',
      MEDICAL_NOTE_PROMPT_VERSION: 'MEDICAL_NOTE_SYSTEM_PROMPT_V3',
      DIFFERENTIAL_PROMPT_VERSION: 'DIFFERENTIAL_SYSTEM_PROMPT_V3',
      FINDINGS_PROMPT_VERSION: 'FINDINGS_SYSTEM_PROMPT_V2',
      REASONING_PROMPT_VERSION: 'REASONING_SYSTEM_PROMPT_V3',
      THERAPY_REASONING_PROMPT_VERSION: 'THERAPY_REASONING_SYSTEM_PROMPT_V3_REVIEWED_BACKGROUND',
      THERAPY_NOTE_PROMPT_VERSION: 'THERAPY_NOTE_SYSTEM_PROMPT_V3',
      INTAKE_NOTE_PROMPT_VERSION: 'INTAKE_NOTE_SYSTEM_PROMPT_V3',
      MISSED_THEMES_PROMPT_VERSION: 'MISSED_THEMES_SYSTEM_PROMPT_V2',
      CLINICAL_ANALYSIS_PROMPT_VERSION: 'CLINICAL_ANALYSIS_SYSTEM_PROMPT_V5',
      INITIAL_ASSESSMENT_PROMPT_VERSION: 'INITIAL_ASSESSMENT_SYSTEM_PROMPT_V3',
      THERAPY_SCRIPT_PROMPT_VERSION: 'THERAPY_SCRIPT_SYSTEM_PROMPT_V3',
      PRE_SESSION_BRIEF_PROMPT_VERSION: 'PRE_SESSION_BRIEF_SYSTEM_PROMPT_V2',
      CASE_BRIEFING_PROMPT_VERSION: 'CASE_BRIEFING_SYSTEM_PROMPT_V2',
      CASE_CONSULT_PROMPT_VERSION: 'CASE_CONSULT_SYSTEM_PROMPT_V2',
      CONCEPTUAL_MAP_PROMPT_VERSION: 'CONCEPTUAL_MAP_SYSTEM_PROMPT_V2',
      MEDICAL_TRANSCRIBE_PROMPT_VERSION: 'MEDICAL_TRANSCRIBE_SYSTEM_PROMPT_V3',
      PLAN_DICTATION_PROMPT_VERSION: 'PLAN_DICTATION_SYSTEM_PROMPT_V1',
    });
  });
});
