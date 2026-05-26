/**
 * Synthetic 16 kHz mono PCM audio for tests.
 *
 * generateSilence(durationMs) → zero-filled buffer of the right size
 *   (good enough for MockGeminiBackend; passes Pass 1 validation but the
 *    real Gemini won't be able to transcribe it — that's expected for the
 *    happy-path scribe pipeline test)
 *
 * generateTone(durationMs, frequencyHz) → sine wave at given frequency
 *   (useful for sanity tests when checking that audio bytes arrive at the
 *    backend, but still doesn't contain speech)
 */

const SAMPLE_RATE = 16_000;
const BYTES_PER_SAMPLE = 2; // 16-bit LE

export function generateSilence(durationMs: number): Buffer {
  const samples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  return Buffer.alloc(samples * BYTES_PER_SAMPLE, 0);
}

export function generateTone(durationMs: number, frequencyHz = 440): Buffer {
  const samples = Math.floor((durationMs / 1000) * SAMPLE_RATE);
  const buf = Buffer.alloc(samples * BYTES_PER_SAMPLE);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const amplitude = Math.sin(2 * Math.PI * frequencyHz * t) * 0.3;
    const intValue = Math.round(amplitude * 32_767);
    buf.writeInt16LE(intValue, i * BYTES_PER_SAMPLE);
  }
  return buf;
}
