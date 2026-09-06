import type { MindRecoveryInput, SpeakerSegment } from '@cureocity/contracts';

export interface RecoveryPrefix {
  version: 1;
  transcript: string;
  speakerSegments: SpeakerSegment[];
}

export function buildRecoveryPrefix(utterances: MindRecoveryInput['utterances']): RecoveryPrefix {
  return {
    version: 1,
    transcript: utterances
      .map(
        (u) =>
          `${u.speaker === 'doctor' ? 'Therapist' : u.speaker === 'patient' ? 'Client' : 'Speaker'}: ${u.text.trim()}`,
      )
      .join('\n'),
    speakerSegments: utterances.map((u) => ({
      speaker:
        u.speaker === 'doctor' ? 'therapist' : u.speaker === 'patient' ? 'client' : 'unknown',
      text: u.text.trim(),
      startMs: u.tStartMs,
      endMs: u.tEndMs,
    })),
  };
}

export function canExtendRecoveryPrefix(previous: RecoveryPrefix, next: RecoveryPrefix): boolean {
  return (
    next.transcript === previous.transcript ||
    next.transcript.startsWith(`${previous.transcript}\n`)
  );
}

/** Prefix remains a separate source; never merge the previously assembled draft again. */
export function mergeRecoveryPrefix<
  T extends { transcript: string; speakerSegments: SpeakerSegment[] },
>(prefix: RecoveryPrefix, batch: T): T {
  const offset = Math.max(0, ...prefix.speakerSegments.map((s) => s.endMs));
  return {
    ...batch,
    transcript: [prefix.transcript, batch.transcript].filter(Boolean).join('\n'),
    speakerSegments: [
      ...prefix.speakerSegments,
      ...batch.speakerSegments.map((s) => ({
        ...s,
        startMs: s.startMs + offset,
        endMs: s.endMs + offset,
      })),
    ],
  };
}
