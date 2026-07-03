import type { AsrFixture } from './fixtures';

/**
 * Sprint DS8 — a pluggable ASR engine for the benchmark. The scorer is
 * engine-agnostic; swap the engine to compare transcription backends
 * against the same reference set.
 */
export interface IAsrEngine {
  readonly name: string;
  /** Produce a transcript for the fixture (from its audio, in a real engine). */
  transcribe(fixture: AsrFixture): Promise<string>;
}

/**
 * The default engine: returns the fixture's stored representative
 * hypothesis. Deterministic, no audio, no creds — so the harness + gate
 * are exercised in CI. Replace with a real engine (below) once the
 * actor-recorded audio exists.
 */
export class MockAsrEngine implements IAsrEngine {
  readonly name = 'mock';
  transcribe(fixture: AsrFixture): Promise<string> {
    return Promise.resolve(fixture.mockHypothesis);
  }
}

/**
 * The integration point for the REAL benchmark: an engine that streams the
 * fixture's recorded audio through the live Vertex Pass-1 transcription
 * backend (asia-south1) and returns what it heard. Wiring it needs the
 * actor-recorded WAVs keyed by `fixture.id` + Vertex creds — neither of
 * which lives in the repo — so it is intentionally a guarded stub: the
 * runner selects it under `ASR_ENGINE=vertex`, and it fails loudly with
 * what's missing rather than silently scoring nothing.
 */
export class VertexAsrEngine implements IAsrEngine {
  readonly name = 'vertex';
  constructor(private readonly audioDir?: string) {}
  transcribe(_fixture: AsrFixture): Promise<string> {
    throw new Error(
      'VertexAsrEngine needs actor-recorded audio (set ASR_AUDIO_DIR to a folder of ' +
        '<fixture-id>.wav) + Vertex creds. See docs/asr-benchmark.md for the recording protocol.',
    );
  }
}
