import { z } from 'zod';
import { SpeakerSegmentSchema, type SpeakerSegment, type Utterance } from '@cureocity/contracts';

export const TRANSCRIPTION_REVIEW_WARNING =
  'Some speech could not be transcribed reliably. Review the transcript and add missing details before signing.';

const SavedTranscriptSchema = z.object({
  format: z.literal('cureocity-transcript-v1'),
  transcript: z.string(),
  speakerSegments: z.array(SpeakerSegmentSchema),
  transcriptionWarning: z.boolean().default(false),
});

/** The complete payload is encrypted in transcriptEncrypted. Never write
 * these segment texts into the legacy plaintext speakerSegments column. */
export function encodeSavedTranscript(
  transcript: string,
  speakerSegments: SpeakerSegment[],
  transcriptionWarning = false,
): string {
  return JSON.stringify(
    SavedTranscriptSchema.parse({
      format: 'cureocity-transcript-v1',
      transcript,
      speakerSegments,
      transcriptionWarning,
    }),
  );
}

/** Old encrypted values are plain transcript text. Do not rewrite historical
 * text or infer speaker labels from what a sentence appears to mean. */
export function decodeSavedTranscript(plaintext: string): {
  transcript: string;
  speakerSegments: SpeakerSegment[] | null;
  transcriptionWarning: boolean;
} {
  try {
    const value = JSON.parse(plaintext);
    if (value?.format === 'cureocity-transcript-v1') {
      const decoded = SavedTranscriptSchema.safeParse(value);
      if (!decoded.success) throw new Error('Invalid saved transcript format');
      return decoded.data;
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid saved transcript format') throw error;
  }
  return { transcript: plaintext, speakerSegments: null, transcriptionWarning: false };
}

export function segmentsFromUtterances(utterances: Utterance[]): SpeakerSegment[] {
  return [...utterances]
    .sort((a, b) => a.tStartMs - b.tStartMs)
    .filter((u) => u.text.trim().length > 0 && u.tEndMs > 0)
    .map((u) => ({
      speaker:
        u.speaker === 'doctor' ? 'therapist' : u.speaker === 'patient' ? 'client' : 'unknown',
      startMs: u.tStartMs,
      endMs: u.tEndMs,
      text: u.text.trim(),
    }));
}

/** Labels are retained only when segments cover the exact saved text.
 * Older gateways may send a transcript the browser's utterances do not cover. */
export function matchingTranscriptSegments(
  transcript: string,
  utterances: Utterance[],
): SpeakerSegment[] {
  const segments = segmentsFromUtterances(utterances);
  const words = (text: string) => text.trim().replace(/\s+/g, ' ');
  const raw = segments.map((s) => s.text).join(' ');
  const labelled = segments
    .map(
      (s) =>
        `${s.speaker === 'therapist' ? 'Therapist' : s.speaker === 'client' ? 'Client' : 'Speaker'}: ${s.text}`,
    )
    .join('\n');
  return [raw, labelled].some((candidate) => words(candidate) === words(transcript))
    ? segments
    : [];
}

/** Visual line breaks only: keep every word and never manufacture turns. */
export function transcriptParagraphs(transcript: string): string[] {
  return transcript.split(/\n+/).flatMap((line) => {
    const words = line.trim().split(/\s+/).filter(Boolean);
    const paragraphs: string[] = [];
    for (let i = 0; i < words.length; i += 65) paragraphs.push(words.slice(i, i + 65).join(' '));
    return paragraphs;
  });
}
