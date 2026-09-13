import { describe, expect, it, vi } from 'vitest';
import { Pass2BackendError, VertexGeminiProGlobalBackend } from './vertex-pro-global.backend';
import { FLASH_PRICING } from '../pricing';

const therapyNoteWithNullModalitySpecific = JSON.stringify({
  version: 'V1',
  modality: 'CBT',
  subjective: 'Client reported improvement.',
  objective: 'Client was engaged.',
  assessment: 'Progress is evident.',
  plan: 'Continue the agreed plan.',
  riskFlags: { severity: 'none', indicators: [] },
  modalitySpecific: null,
});

describe('VertexGeminiProGlobalBackend', () => {
  it.each(['valid', 'invalid'])(
    'retains billable thinking and actual model prices on %s provider output',
    async (shape) => {
      const backend = new VertexGeminiProGlobalBackend({
        projectId: 'test-project',
        model: 'gemini-2.5-pro',
        pricing: FLASH_PRICING,
      });
      Object.assign(backend as unknown as Record<string, unknown>, {
        ai: {
          models: {
            generateContent: vi.fn().mockResolvedValue({
              text: shape === 'valid' ? therapyNoteWithNullModalitySpecific : '{invalid json',
              usageMetadata: {
                promptTokenCount: 1000,
                candidatesTokenCount: 200,
                thoughtsTokenCount: 800,
              },
            }),
          },
        },
      });
      const request = backend.run({
        sessionId: 'test-session',
        transcript: 'Fictional test transcript.',
        speakerSegments: [],
        kind: 'TREATMENT',
        modality: 'CBT',
        vertical: 'THERAPIST',
        clientContext: {},
      });
      const result = await request.catch((error: unknown) => {
        expect(error).toBeInstanceOf(Pass2BackendError);
        return error as Pass2BackendError;
      });
      expect(result.callLog).toMatchObject({
        inputTokens: 1000,
        outputTokens: 1000,
        costInr: 0.9338,
        status: shape === 'valid' ? 'SUCCESS' : 'ERROR',
      });
    },
  );

  it('treats a null optional modalitySpecific field as omitted', async () => {
    const backend = new VertexGeminiProGlobalBackend({ projectId: 'test-project' });
    const generateContent = vi.fn().mockResolvedValue({
      text: therapyNoteWithNullModalitySpecific,
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    });

    Object.assign(backend as unknown as Record<string, unknown>, {
      ai: { models: { generateContent } },
    });

    const result = await backend.run({
      sessionId: 'test-session',
      transcript: 'De-identified test transcript.',
      speakerSegments: [
        { speaker: 'client', startMs: 0, endMs: 1000, text: 'De-identified test transcript.' },
      ],
      kind: 'TREATMENT',
      modality: 'CBT',
      vertical: 'THERAPIST',
      clientContext: {},
    });

    expect(result.output.kind).toBe('TREATMENT');
    if (result.output.kind !== 'TREATMENT') throw new Error('Expected treatment output');
    expect(result.output.therapyNote.modalitySpecific).toBeUndefined();
  });
});
