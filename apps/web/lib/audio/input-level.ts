/** RMS amplitude of captured PCM samples; silence is zero and full scale is one. */
export function measureInputLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of samples) {
    // A malformed sample must not make the whole meter NaN or infinite.
    if (Number.isFinite(sample)) sumSquares += sample * sample;
  }
  return Math.min(1, Math.sqrt(sumSquares / samples.length));
}
