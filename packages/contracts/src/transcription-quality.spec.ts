import { describe, expect, it } from 'vitest';
import { containsTranscriptionArtifact } from './transcription-quality';

describe('containsTranscriptionArtifact', () => {
  it.each([
    'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).',
    'Replace verbatim per PRD 24.1 (pending clinical sign-off).',
    'PLACEHOLDER: refine verbatim wording before pilot.',
    'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the audio input.',
    'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the provided audio input.',
    'This is a placeholder for the audio transcription. The actual transcription will be generated based on provided audio input.',
    'placeholder:\nThis is a placeholder for the audio transcription.',
    'The client spoke. PLACEHOLDER: refine verbatim wording before pilot. More words.',
    'എനിക്ക് anxiety ഉണ്ട്. PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).',
  ])('detects a known generated artifact: %s', (text) => {
    expect(containsTranscriptionArtifact(text)).toBe(true);
  });

  it.each([
    '',
    '[inaudible]',
    'I used a placeholder in my presentation.',
    'Sharafath called me yesterday.',
    'The placeholder made me anxious.',
    'PLACEHOLDER: I used that label for my draft at work.',
    'We talked about the audio transcription and its mistakes.',
    'എനിക്ക് ഉത്കണ്ഠ തോന്നുന്നു.',
    'ഇന്ന് Sharafath വിളിച്ചു. ആ document-ൽ ഒരു placeholder ഉണ്ടായിരുന്നു.',
    'എനിക്ക് anxiety undu, but breathing exercises help cheythu.',
    'Mujhe anxiety hai, but I used a placeholder for the name.',
  ])('preserves genuine speech and uncertainty: %s', (text) => {
    expect(containsTranscriptionArtifact(text)).toBe(false);
  });
});
