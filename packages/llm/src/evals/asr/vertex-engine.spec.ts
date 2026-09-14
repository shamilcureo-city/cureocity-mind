import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IPass1Backend } from '../../types';
import { VertexAsrEngine } from './engine';
import { ASR_FIXTURES } from './fixtures';
import { decodeEvaluationWav } from './wav';

function wav(extra = false): Buffer {
  const pcm = Buffer.from([1, 0, 2, 0]);
  const bytes = Buffer.alloc(44 + pcm.length + (extra ? 10 : 0));
  bytes.write('RIFF');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  let offset = 36;
  if (extra) {
    bytes.write('JUNK', offset);
    bytes.writeUInt32LE(1, offset + 4);
    offset += 10;
  }
  bytes.write('data', offset);
  bytes.writeUInt32LE(pcm.length, offset + 4);
  pcm.copy(bytes, offset + 8);
  return bytes;
}

const fixture = ASR_FIXTURES[0];
const backend = () => ({
  run: vi.fn(async () => ({
    output: {
      transcript: 'actor words',
      speakerSegments: [],
      affectFeatures: [],
      detectedLanguages: ['en'],
    },
    callLog: {
      sessionId: null,
      pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE' as const,
      model: 'injected',
      region: 'test',
      promptVersion: 'test-v1',
      inputTokens: 1,
      outputTokens: 1,
      costInr: 0,
      latencyMs: 1,
      status: 'SUCCESS' as const,
    },
  })),
});

const dirs: string[] = [];
async function directory(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mind-eval-wav-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('evaluation WAV parser', () => {
  it('strips the WAV header and handles an odd padded metadata chunk', () => {
    for (const extra of [false, true]) {
      const parsed = decodeEvaluationWav(wav(extra));
      expect(parsed.pcm).toEqual(Buffer.from([1, 0, 2, 0]));
      expect(parsed.durationMs).toBe(0.125);
    }
  });
  it.each([22, 24, 28, 32, 34])(
    'rejects unsupported channels/rate/alignment/bits at %s',
    (offset) => {
      const bytes = wav();
      bytes[offset] ^= 1;
      expect(() => decodeEvaluationWav(bytes)).toThrow('UNSUPPORTED_WAV_FORMAT');
    },
  );
  it('rejects truncation, malformed chunk size, and empty PCM', () => {
    expect(() => decodeEvaluationWav(wav().subarray(0, 45))).toThrow('INVALID_EVALUATION_WAV');
    const invalid = wav();
    invalid.writeUInt32LE(999, 40);
    expect(() => decodeEvaluationWav(invalid)).toThrow('INVALID_EVALUATION_WAV');
    const empty = wav().subarray(0, 44);
    empty.writeUInt32LE(36, 4);
    empty.writeUInt32LE(0, 40);
    expect(() => decodeEvaluationWav(empty)).toThrow('INVALID_EVALUATION_WAV');
  });
});

describe('Vertex ASR adapter, injected and offline', () => {
  it('passes PCM/duration with the Scribe persona by default and records safe provenance', async () => {
    const dir = await directory();
    await writeFile(join(dir, `${fixture.id}.wav`), wav());
    const fake = backend();
    const engine = new VertexAsrEngine(dir, { backend: fake as IPass1Backend });
    expect(await engine.transcribe(fixture)).toBe('actor words');
    expect(fake.run).toHaveBeenCalledWith(
      expect.objectContaining({
        audioBytes: Buffer.from([1, 0, 2, 0]),
        durationMs: 0.125,
        vertical: 'DOCTOR',
      }),
    );
    expect(engine.runs[0]).toMatchObject({ model: 'injected', promptVersion: 'test-v1' });
    expect(engine.runs[0].audioSha256).toHaveLength(64);
    expect(JSON.stringify(engine.runs)).not.toContain('actor words');
  });
  it('explicitly selects Mind and code-mixed language hints', async () => {
    const dir = await directory();
    await writeFile(join(dir, `${fixture.id}.wav`), wav());
    const fake = backend();
    const engine = new VertexAsrEngine(dir, {
      backend: fake as IPass1Backend,
      vertical: 'THERAPIST',
    });
    await engine.transcribe({ ...fixture, spokenLanguages: ['ml', 'en'] });
    expect(fake.run).toHaveBeenCalledWith(
      expect.objectContaining({
        vertical: 'THERAPIST',
        hints: { spokenLanguageHints: ['ml', 'en'] },
      }),
    );
  });
  it('does not construct/call a provider merely because a project exists', async () => {
    const engine = new VertexAsrEngine('/not-read', { projectId: 'configured' });
    await expect(engine.transcribe(fixture)).rejects.toThrow('PROVIDER_CALLS_NOT_AUTHORIZED');
  });
  it('missing/invalid audio fails before backend invocation without disclosing the path', async () => {
    const fake = backend();
    const dir = await directory();
    const engine = new VertexAsrEngine(dir, { backend: fake as IPass1Backend });
    await expect(engine.transcribe(fixture)).rejects.toThrow('EVALUATION_AUDIO_UNAVAILABLE');
    await expect(engine.transcribe({ ...fixture, id: '../private' })).rejects.toThrow(
      'INVALID_FIXTURE_ID',
    );
    await writeFile(join(dir, `${fixture.id}.wav`), Buffer.from('private content'));
    await expect(engine.transcribe(fixture)).rejects.toThrow('INVALID_EVALUATION_WAV');
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('rejects audio symlinks outside the supplied corpus directory', async () => {
    const dir = await directory();
    const external = await directory();
    await writeFile(join(external, 'outside.wav'), wav());
    await symlink(join(external, 'outside.wav'), join(dir, `${fixture.id}.wav`));
    const fake = backend();
    await expect(
      new VertexAsrEngine(dir, { backend: fake as IPass1Backend }).transcribe(fixture),
    ).rejects.toThrow('AUDIO_OUTSIDE_EVALUATION_DIRECTORY');
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('redacts backend exception content', async () => {
    const dir = await directory();
    await writeFile(join(dir, `${fixture.id}.wav`), wav());
    const fake: IPass1Backend = {
      run: vi.fn().mockRejectedValue(new Error('private transcript response')),
    };
    await expect(new VertexAsrEngine(dir, { backend: fake }).transcribe(fixture)).rejects.toThrow(
      /^ASR_BACKEND_FAILED$/,
    );
  });
});
