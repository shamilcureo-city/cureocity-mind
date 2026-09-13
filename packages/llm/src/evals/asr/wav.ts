/** Evaluation accepts the same PCM format as Pass 1; it never silently resamples. */
export const MAX_EVAL_WAV_BYTES = 128 * 1024 * 1024;

export class AsrEvaluationUnavailableError extends Error {
  constructor(readonly code: string) {
    // Only stable codes may reach CLI logs, never provider payloads or file paths.
    super(code);
    this.name = 'AsrEvaluationUnavailableError';
  }
}

export function decodeEvaluationWav(wav: Buffer): { pcm: Buffer; durationMs: number } {
  const invalid = () => new AsrEvaluationUnavailableError('INVALID_EVALUATION_WAV');
  if (
    wav.length < 44 ||
    wav.length > MAX_EVAL_WAV_BYTES ||
    wav.toString('ascii', 0, 4) !== 'RIFF' ||
    wav.toString('ascii', 8, 12) !== 'WAVE' ||
    wav.readUInt32LE(4) + 8 !== wav.length
  )
    throw invalid();

  let formatSeen = false;
  let pcm: Buffer | undefined;
  let offset = 12;
  while (offset < wav.length) {
    if (offset + 8 > wav.length) throw invalid();
    const tag = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    const next = start + size + (size % 2);
    if (next > wav.length) throw invalid();
    if (tag === 'fmt ') {
      if (formatSeen || size < 16) throw invalid();
      formatSeen = true;
      if (
        wav.readUInt16LE(start) !== 1 ||
        wav.readUInt16LE(start + 2) !== 1 ||
        wav.readUInt32LE(start + 4) !== 16_000 ||
        wav.readUInt32LE(start + 8) !== 32_000 ||
        wav.readUInt16LE(start + 12) !== 2 ||
        wav.readUInt16LE(start + 14) !== 16
      )
        throw new AsrEvaluationUnavailableError('UNSUPPORTED_WAV_FORMAT');
    } else if (tag === 'data') {
      if (pcm || size === 0 || size % 2 !== 0) throw invalid();
      pcm = wav.subarray(start, start + size);
    }
    offset = next;
  }
  if (!formatSeen || !pcm) throw invalid();
  return { pcm, durationMs: pcm.length / 32 };
}
