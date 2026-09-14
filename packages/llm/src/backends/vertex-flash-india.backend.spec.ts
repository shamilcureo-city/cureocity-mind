import { describe, expect, it, vi } from 'vitest';
import type { Pass1Input } from '../types';
import { VertexGeminiFlashIndiaBackend } from './vertex-flash-india.backend';
import { estimateVertexUsageCostInr, FLASH_AUDIO_PRICING } from '../pricing';

const fictionalOutput = {
  transcript: 'The green cup is beside the notebook.',
  speakerSegments: [
    {
      speaker: 'unknown',
      text: 'The green cup is beside the notebook.',
      startMs: 0,
      endMs: 1000,
      language: 'en',
    },
  ],
  affectFeatures: [],
  detectedLanguages: ['en'],
};

function setup(model = 'gemini-2.5-flash', text = JSON.stringify(fictionalOutput)) {
  const backend = new VertexGeminiFlashIndiaBackend({ projectId: 'test-project', model });
  const generateContent = vi.fn().mockResolvedValue({
    text,
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
  });
  // No credentials, network, real audio, or clinical model calls are used.
  Object.assign(backend as unknown as Record<string, unknown>, {
    ai: { models: { generateContent } },
  });
  return { backend, generateContent };
}

const input: Pass1Input = {
  sessionId: 'fictional-live-speed-test',
  audioBytes: Buffer.alloc(32_000),
  durationMs: 1000,
  vertical: 'THERAPIST',
};

describe('Mind live transcription thinking policy', () => {
  it('opts supported Mind live windows into zero thinking without truncating output', async () => {
    const { backend, generateContent } = setup();
    const result = await backend.run({ ...input, latencyMode: 'realtime' });

    expect(generateContent).toHaveBeenCalledTimes(1);
    const request = generateContent.mock.calls[0]![0];
    expect(request.model).toBe('gemini-2.5-flash');
    expect(request.config).toMatchObject({
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      maxOutputTokens: 65536,
    });
    const wav = Buffer.from(request.contents[0].parts[0].inlineData.data, 'base64');
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(44)).toEqual(input.audioBytes);
    expect(result.output).toEqual(fictionalOutput);
    expect(result.callLog).toMatchObject({ status: 'SUCCESS', region: 'asia-south1' });
  });

  it.each([
    { name: 'batch therapist', overrides: {} },
    { name: 'batch doctor', overrides: { vertical: 'DOCTOR' as const } },
    {
      name: 'doctor with an accidental live hint',
      overrides: { vertical: 'DOCTOR' as const, latencyMode: 'realtime' as const },
    },
    {
      name: 'caller without an explicit Mind vertical',
      overrides: { vertical: undefined, latencyMode: 'realtime' as const },
    },
  ])('leaves $name model configuration unchanged', async ({ overrides }) => {
    const { backend, generateContent } = setup();
    await backend.run({ ...input, ...overrides });
    expect(generateContent.mock.calls[0]![0].config).not.toHaveProperty('thinkingConfig');
  });

  it.each(['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-3-flash', 'custom-model'])(
    'does not send an incompatible zero-thinking option to %s',
    async (model) => {
      const { backend, generateContent } = setup(model);
      await backend.run({ ...input, latencyMode: 'realtime' });
      expect(generateContent.mock.calls[0]![0].config).not.toHaveProperty('thinkingConfig');
    },
  );

  it('uses the same prompt and validated output shape as the batch path', async () => {
    const { backend, generateContent } = setup();
    const batch = await backend.run(input);
    const live = await backend.run({ ...input, latencyMode: 'realtime' });
    const batchConfig = generateContent.mock.calls[0]![0].config;
    const { thinkingConfig, ...liveConfig } = generateContent.mock.calls[1]![0].config;
    expect(thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(liveConfig).toEqual(batchConfig);
    expect(live.output).toEqual(batch.output);
    expect(live.callLog.promptVersion).toBe(batch.callLog.promptVersion);
  });

  it('still rejects malformed model JSON instead of emitting it as transcript text', async () => {
    const { backend } = setup('gemini-2.5-flash', 'not a valid transcript object');
    const result = await backend.run({ ...input, latencyMode: 'realtime' });
    expect(result.callLog.status).toBe('ERROR');
    expect(result.output.transcript).toBe('');
    expect(result.output.speakerSegments).toEqual([]);
  });
});

describe('Pass 1 rejects generated transcription artifacts', () => {
  const artifact =
    'PLACEHOLDER: Replace verbatim per PRD 22.1 Part 10.3 (pending Sharafath sign-off).';
  const boilerplate =
    'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the provided audio input.';

  it.each(['THERAPIST', 'DOCTOR'] as const)(
    'rejects leaked prompt text for %s and does not log its contents',
    async (vertical) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const { backend, generateContent } = setup(
          'gemini-2.5-flash',
          JSON.stringify({ ...fictionalOutput, transcript: artifact }),
        );
        const result = await backend.run({ ...input, vertical });
        expect(generateContent).toHaveBeenCalledTimes(1);
        expect(generateContent.mock.calls[0]![0].config.systemInstruction).not.toContain(
          'PLACEHOLDER',
        );
        expect(result.output).toEqual({
          transcript: '',
          speakerSegments: [],
          affectFeatures: [],
          detectedLanguages: [],
        });
        expect(result.callLog).toMatchObject({
          status: 'ERROR',
          errorMessage: 'TRANSCRIPTION_ARTIFACT',
          inputTokens: 10,
          outputTokens: 20,
        });
        expect(result.callLog.costInr).toBeGreaterThan(0);
        expect(JSON.stringify(result.callLog)).not.toContain(artifact);
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('rejects generated boilerplate in a segment even when the transcript is clean', async () => {
    const { backend } = setup(
      'gemini-2.5-flash',
      JSON.stringify({
        ...fictionalOutput,
        speakerSegments: [{ ...fictionalOutput.speakerSegments[0], text: boilerplate }],
      }),
    );
    const result = await backend.run(input);
    expect(result.callLog.errorMessage).toBe('TRANSCRIPTION_ARTIFACT');
    expect(result.output.transcript).toBe('');
    expect(result.output.speakerSegments).toEqual([]);
  });

  it('retains actual input, candidate and thought-token usage when output is rejected', async () => {
    const { backend, generateContent } = setup();
    const usage = {
      promptTokenCount: 1000,
      candidatesTokenCount: 80,
      thoughtsTokenCount: 25,
      promptTokensDetails: [
        { modality: 'TEXT', tokenCount: 500 },
        { modality: 'AUDIO', tokenCount: 500 },
      ],
    };
    generateContent.mockResolvedValue({
      text: JSON.stringify({ ...fictionalOutput, transcript: artifact }),
      usageMetadata: usage,
    });
    const result = await backend.run(input);
    const expected = estimateVertexUsageCostInr({
      model: 'gemini-2.5-flash',
      usage,
      fallbackInputTokens: 0,
      fallbackPricing: FLASH_AUDIO_PRICING,
    });
    expect(result.callLog).toMatchObject({
      status: 'ERROR',
      errorMessage: 'TRANSCRIPTION_ARTIFACT',
      inputTokens: 1000,
      outputTokens: 105,
      costInr: expected.costInr,
    });
  });

  it('does not put malformed provider output into an error message', async () => {
    const secretFixture = 'FICTIONAL_PRIVATE_SENTENCE';
    const { backend } = setup('gemini-2.5-flash', `{"transcript":${secretFixture}}`);
    const result = await backend.run(input);
    expect(result.callLog.errorMessage).toBe('INVALID_TRANSCRIPTION_OUTPUT');
    expect(JSON.stringify(result)).not.toContain(secretFixture);
  });

  it('does not report a known rejected HTTP request as billed model usage', async () => {
    const { backend, generateContent } = setup();
    generateContent.mockRejectedValue({ status: 403, message: 'Permission denied' });
    const result = await backend.run(input);
    expect(result.callLog).toMatchObject({
      status: 'ERROR',
      inputTokens: 0,
      outputTokens: 0,
      costInr: 0,
    });
  });

  it.each([
    'I used a placeholder in my presentation. Sharafath helped me.',
    'എനിക്ക് ഉത്കണ്ഠ തോന്നുന്നു.',
    'എനിക്ക് anxiety undu, but breathing exercises help cheythu.',
  ])('keeps genuine transcript and segment text unchanged: %s', async (text) => {
    const output = {
      ...fictionalOutput,
      transcript: text,
      speakerSegments: [{ ...fictionalOutput.speakerSegments[0], text }],
    };
    const { backend } = setup('gemini-2.5-flash', JSON.stringify(output));
    const result = await backend.run(input);
    expect(result.callLog.status).toBe('SUCCESS');
    expect(result.output).toEqual(output);
  });
});
