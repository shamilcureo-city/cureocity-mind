import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyNoteV1Schema } from '@cureocity/contracts';
const mocks = vi.hoisted(() => ({ pass2: vi.fn(), log: vi.fn(), circuit: vi.fn() }));
vi.mock('./llm', () => ({ modelRouter: () => ({ pass2: mocks.pass2 }) }));
vi.mock('./prisma', () => ({ prisma: { geminiCallLog: { create: mocks.log } } }));
vi.mock('./cost-guard', () => ({ checkCostCircuit: mocks.circuit }));
import { reformatNoteTemplate } from './reformat-note-template';
const note = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'CBT',
  subjective: 'Clinician corrected account',
  objective: 'Observation',
  assessment: 'Uncertain',
  plan: 'Agreed action',
  riskFlags: { severity: 'medium', indicators: ['Fictional risk'] },
  templateSections: [{ title: 'Old', body: 'Old display' }],
});
const input = {
  sessionId: 'session',
  psychologistId: 'owner',
  kind: 'TREATMENT' as const,
  content: note,
  template: { name: 'Custom', sections: [{ title: 'New' }] },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pass2.mockResolvedValue({
    output: {
      kind: 'TREATMENT',
      therapyNote: {
        ...note,
        subjective: 'MODEL MUST NOT REPLACE THE CORRECTION',
        riskFlags: { severity: 'none' },
        templateSections: [{ title: 'New', body: 'Reformatted account' }],
      },
    },
    callLog: {
      pass: 'PASS_2',
      model: 'mock',
      region: 'test',
      promptVersion: 'test',
      inputTokens: 1,
      outputTokens: 1,
      costInr: 0.01,
      latencyMs: 1,
      status: 'OK',
    },
  });
});
describe('note template reformatting', () => {
  it('changes the format of a completed note without replacing clinician corrections or safety fields', async () => {
    const next = await reformatNoteTemplate(input);
    expect(next).toEqual({
      ...note,
      templateSections: [{ title: 'New', body: 'Reformatted account' }],
    });
    expect(mocks.pass2.mock.calls[0]![0].transcript).toContain('Clinician corrected account');
    expect(mocks.circuit).toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalled();
  });
  it('clears a template without an AI call and preserves the authoritative note', async () => {
    const next = await reformatNoteTemplate({ ...input, template: null });
    const { templateSections: _old, ...expected } = note;
    expect(next).toEqual(expected);
    expect(mocks.pass2).not.toHaveBeenCalled();
  });
  it('rejects a model view with missing or incorrect template headings', async () => {
    await expect(
      reformatNoteTemplate({
        ...input,
        template: {
          name: 'Custom',
          sections: [{ title: 'Expected' }],
        },
      }),
    ).rejects.toThrow('could not be prepared');
  });
});
