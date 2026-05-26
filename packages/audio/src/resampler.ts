/**
 * Polyphase FIR decimator: Float32 audio at 48 kHz mono → Float32 audio
 * at 16 kHz mono.
 *
 * Design:
 *   - Decimation factor M = 3 (48 000 / 16 000)
 *   - Anti-alias filter: windowed-sinc lowpass at fs/2M = 8 kHz cutoff
 *     (Nyquist of 16 kHz output) with a Hann window
 *   - Filter length L = 96 taps (32 taps per polyphase branch)
 *   - Polyphase form: split the FIR into M sub-filters and process one
 *     sub-filter per output sample. Standard textbook formulation.
 *
 * Stateful — keeps a tap-state buffer across chunks so consecutive
 * `process()` calls produce a continuous output (no clicks at chunk
 * boundaries). Call `reset()` between sessions.
 *
 * Pure JS so it runs in both AudioWorkletGlobalScope (where WASM has
 * boot-time costs) and node tests.
 */

const FILTER_TAPS = 96;
const CUTOFF_HZ = 7_500; // a touch below 8 kHz Nyquist to leave transition band
const SOURCE_RATE = 48_000;

function buildWindowedSinc(taps: number, cutoffHz: number, sampleRate: number): Float32Array {
  const fc = cutoffHz / sampleRate;
  const M = taps - 1;
  const coeffs = new Float32Array(taps);
  let sum = 0;
  for (let n = 0; n < taps; n++) {
    const k = n - M / 2;
    // sinc(2 * fc * k)
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    // Hann window
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / M);
    coeffs[n] = sinc * w;
    sum += coeffs[n]!;
  }
  // Normalise to unity DC gain
  for (let n = 0; n < taps; n++) coeffs[n] = coeffs[n]! / sum;
  return coeffs;
}

export class PolyphaseDecimator {
  private readonly factor: number;
  private readonly polyphase: Float32Array[];
  private readonly tapsPerBranch: number;
  /** Circular history of inputs across all branches, length = tapsPerBranch * factor. */
  private readonly state: Float32Array;
  /** Write cursor into the input history. */
  private writeIdx = 0;
  /**
   * Counts incoming samples modulo the decimation factor; emit an output
   * sample whenever it hits factor - 1 (which makes the last branch
   * the one that contributes the most-recent sample).
   */
  private phase = 0;

  constructor(factor = 3, taps = FILTER_TAPS) {
    if (taps % factor !== 0) {
      throw new Error(`Filter length ${taps} must be divisible by decimation factor ${factor}`);
    }
    this.factor = factor;
    this.tapsPerBranch = taps / factor;
    const proto = buildWindowedSinc(taps, CUTOFF_HZ, SOURCE_RATE);
    // Split into polyphase branches. Branch e holds coeffs at indices
    // e, e+M, e+2M, ...; this lets us process one input per cycle and
    // emit one output per M inputs.
    this.polyphase = [];
    for (let e = 0; e < factor; e++) {
      const branch = new Float32Array(this.tapsPerBranch);
      for (let k = 0; k < this.tapsPerBranch; k++) {
        branch[k] = proto[k * factor + e] ?? 0;
      }
      this.polyphase.push(branch);
    }
    this.state = new Float32Array(this.tapsPerBranch * factor);
  }

  reset(): void {
    this.state.fill(0);
    this.writeIdx = 0;
    this.phase = 0;
  }

  /**
   * Pushes input samples; returns the output samples produced by this
   * call. Output length is approximately `input.length / factor`.
   */
  process(input: Float32Array): Float32Array {
    const M = this.factor;
    const out: number[] = [];

    for (let i = 0; i < input.length; i++) {
      this.state[this.writeIdx] = input[i]!;
      this.writeIdx = (this.writeIdx + 1) % this.state.length;
      this.phase = (this.phase + 1) % M;

      if (this.phase === 0) {
        // Emit one output. Compute by summing across all polyphase
        // branches with the most-recent input as branch 0.
        let acc = 0;
        for (let e = 0; e < M; e++) {
          const branch = this.polyphase[e]!;
          for (let k = 0; k < this.tapsPerBranch; k++) {
            // Sample for branch e at lag k is `factor*k + e` steps back
            // from writeIdx-1 (writeIdx points to the NEXT slot).
            const sampleIdx =
              (this.writeIdx - 1 - (k * M + e) + this.state.length * 2) % this.state.length;
            acc += branch[k]! * this.state[sampleIdx]!;
          }
        }
        out.push(acc);
      }
    }

    return new Float32Array(out);
  }
}
