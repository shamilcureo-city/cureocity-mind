import { describe, expect, it, vi } from 'vitest';
import { VertexGeminiProGlobalBackend } from './vertex-pro-global.backend';

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
