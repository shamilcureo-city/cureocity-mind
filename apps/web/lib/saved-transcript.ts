import { z } from 'zod';
import {
  containsTranscriptionArtifact,
  SpeakerSegmentSchema,
  type SpeakerSegment,
  type Utterance,
} from '@cureocity/contracts';

export const TRANSCRIPTION_REVIEW_WARNING =
  'Some speech could not be transcribed reliably. Review the transcript and add missing details before signing.';
export const TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE =
  'This transcript contains invalid generated or system text, so its words are hidden from clinical views. The encrypted source record is unchanged. Recover it from the original recording, or use a clinician-written note, before signing or sharing.';

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
  if (
    containsTranscriptionArtifact(transcript) ||
    speakerSegments.some((segment) => containsTranscriptionArtifact(segment.text))
  ) {
    throw new Error('Refusing to save a transcript containing generated control text');
  }
  return JSON.stringify(
    SavedTranscriptSchema.parse({
      format: 'cureocity-transcript-v1',
      transcript,
      speakerSegments,
      transcriptionWarning,
    }),
  );
}

/** True when any part of the authoritative transcript contains recognizable
 * generated control text. Callers quarantine the complete record rather than
 * trying to edit individual words out of clinical source material. */
export function savedTranscriptContainsArtifact(source: {
  transcript: string;
  speakerSegments: SpeakerSegment[] | null;
}): boolean {
  return (
    containsTranscriptionArtifact(source.transcript) ||
    (source.speakerSegments?.some((segment) => containsTranscriptionArtifact(segment.text)) ??
      false)
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

/** Merge consecutive ASR chunks from the same identified speaker into visual
 * turns. The saved segments are not modified, reordered or relabelled; joining
 * whitespace is presentation-only and every source word remains present. */
export function transcriptConversationTurns(segments: SpeakerSegment[]): SpeakerSegment[] {
  const turns: SpeakerSegment[] = [];
  for (const segment of segments) {
    const previous = turns.at(-1);
    if (previous && previous.speaker !== 'unknown' && previous.speaker === segment.speaker) {
      const pauseMs = Math.max(0, segment.startMs - previous.endMs);
      const separator = pauseMs >= 3_000 ? '\n\n' : ' ';
      previous.text = `${previous.text.trimEnd()}${separator}${segment.text.trimStart()}`;
      previous.endMs = Math.max(previous.endMs, segment.endMs);
      if (previous.language !== segment.language) delete previous.language;
      continue;
    }
    turns.push({ ...segment });
  }
  return turns;
}
