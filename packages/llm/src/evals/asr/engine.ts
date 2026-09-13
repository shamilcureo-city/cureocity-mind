import type { AsrFixture } from './fixtures';
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { IPass1Backend, Pass1Input } from '../../types';
import { VertexGeminiFlashIndiaBackend } from '../../backends/vertex-flash-india.backend';
import { AsrEvaluationUnavailableError, decodeEvaluationWav, MAX_EVAL_WAV_BYTES } from './wav';

export interface AsrAudioFixture {
  id: string;
  language: string;
  spokenLanguages?: string[];
}

/**
 * Sprint DS8 — a pluggable ASR engine for the benchmark. The scorer is
 * engine-agnostic; swap the engine to compare transcription backends
 * against the same reference set.
 */
export interface IAsrEngine<F extends AsrAudioFixture = AsrFixture> {
  readonly name: string;
  /** Produce a transcript for the fixture (from its audio, in a real engine). */
  transcribe(fixture: F): Promise<string>;
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

export interface VertexAsrEngineOptions {
  /** Injected backends make adapter tests entirely offline. */
  backend?: IPass1Backend;
  projectId?: string;
  model?: string;
  location?: string;
  vertical?: Pass1Input['vertical'];
  latencyMode?: Pass1Input['latencyMode'];
  /** Required before the adapter constructs a real, potentially paid backend. */
  allowProviderCalls?: boolean;
}

export interface AsrAudioRunMetadata {
  id: string;
  audioSha256: string;
  durationMs: number;
  model: string;
  region: string;
  promptVersion: string;
}

/** Read a bounded, local actor WAV and pass PCM (not a nested WAV) to Pass 1. */
export class VertexAsrEngine<F extends AsrAudioFixture = AsrFixture> implements IAsrEngine<F> {
  readonly name = 'vertex';
  readonly runs: AsrAudioRunMetadata[] = [];
  private backend?: IPass1Backend;
  constructor(
    private readonly audioDir?: string,
    private readonly options: VertexAsrEngineOptions = {},
  ) {
    this.backend = options.backend;
  }

  async transcribe(fixture: F): Promise<string> {
    if (!this.audioDir) throw new AsrEvaluationUnavailableError('ASR_AUDIO_DIR_REQUIRED');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(fixture.id)) {
      throw new AsrEvaluationUnavailableError('INVALID_FIXTURE_ID');
    }
    if (!this.backend && !this.options.allowProviderCalls) {
      throw new AsrEvaluationUnavailableError('PROVIDER_CALLS_NOT_AUTHORIZED');
    }
    let wav: Buffer;
    try {
      const root = await realpath(this.audioDir);
      const file = await realpath(resolve(root, `${fixture.id}.wav`));
      const inside = relative(root, file);
      if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
        throw new AsrEvaluationUnavailableError('AUDIO_OUTSIDE_EVALUATION_DIRECTORY');
      }
      const handle = await open(file, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_EVAL_WAV_BYTES) {
          throw new AsrEvaluationUnavailableError('INVALID_EVALUATION_AUDIO_FILE');
        }
        wav = await handle.readFile();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof AsrEvaluationUnavailableError) throw error;
      throw new AsrEvaluationUnavailableError('EVALUATION_AUDIO_UNAVAILABLE');
    }
    const { pcm, durationMs } = decodeEvaluationWav(wav);
    if (!this.backend) {
      if (!this.options.projectId)
        throw new AsrEvaluationUnavailableError('VERTEX_PROJECT_REQUIRED');
      this.backend = new VertexGeminiFlashIndiaBackend({
        projectId: this.options.projectId,
        model: this.options.model,
        location: this.options.location ?? 'asia-south1',
        // Explicit attempts make benchmark call counts reproducible.
        maxAttempts: 1,
      });
    }
    try {
      const { output, callLog } = await this.backend.run({
        sessionId: `eval-${fixture.id}`,
        audioBytes: pcm,
        durationMs,
        // Preserve the existing Scribe benchmark's medical persona by default.
        vertical: this.options.vertical ?? 'DOCTOR',
        latencyMode: this.options.latencyMode,
        hints: { spokenLanguageHints: fixture.spokenLanguages ?? [fixture.language] },
      });
      this.runs.push({
        id: fixture.id,
        audioSha256: createHash('sha256').update(wav).digest('hex'),
        durationMs,
        model: callLog.model,
        region: callLog.region,
        promptVersion: callLog.promptVersion,
      });
      return output.transcript;
    } catch {
      throw new AsrEvaluationUnavailableError('ASR_BACKEND_FAILED');
    }
  }
}
