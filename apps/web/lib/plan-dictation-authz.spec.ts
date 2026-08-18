import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pass1: vi.fn(),
  passPlanDictation: vi.fn(),
  assertAuthority: vi.fn(),
  checkCostCircuit: vi.fn(),
  callLogCreate: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('./llm', () => ({
  modelRouter: () => ({
    pass1: mocks.pass1,
    passPlanDictation: mocks.passPlanDictation,
  }),
}));
vi.mock('./scribe-authority', () => ({ assertCurrentScribeAuthority: mocks.assertAuthority }));
vi.mock('./cost-guard', () => ({ checkCostCircuit: mocks.checkCostCircuit }));
vi.mock('./prisma', () => ({
  prisma: { geminiCallLog: { create: mocks.callLogCreate } },
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@cureocity/observability/metrics', () => ({
  recordGeminiCall: vi.fn(),
  recordCostInr: vi.fn(),
}));

import { runPlanDictation, transcribePlanCommand } from './plan-dictation';

function callLog(pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE' | 'PASS_14_PLAN_DICTATION') {
  return {
    sessionId: 'session-1',
    pass,
    model: 'model',
    region: 'asia-south1',
    promptVersion: 'v1',
    inputTokens: 1,
    outputTokens: 1,
    costInr: 0,
    latencyMs: 1,
    status: 'SUCCESS' as const,
  };
}

let pass1Output: {
  transcript: string;
  speakerSegments: Array<{ text: string }>;
  affectFeatures: Array<{ value: string }>;
  detectedLanguages: string[];
};
let pass14Output: {
  dictation: {
    version: 'V1';
    edits: Array<{ action: 'addAdvice'; text: string }>;
    clarifications: string[];
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAuthority.mockResolvedValue({
    psychologistId: 'psy-1',
    clientId: 'client-1',
    vertical: 'DOCTOR',
  });
  mocks.checkCostCircuit.mockResolvedValue(undefined);
  mocks.callLogCreate.mockResolvedValue({ id: 'log-1' });
  mocks.writeAudit.mockResolvedValue(undefined);
  pass1Output = {
    transcript: 'sensitive dictated instruction',
    speakerSegments: [{ text: 'sensitive dictated instruction' }],
    affectFeatures: [{ value: 'sensitive' }],
    detectedLanguages: ['en'],
  };
  pass14Output = {
    dictation: {
      version: 'V1',
      edits: [{ action: 'addAdvice', text: 'sensitive plan output' }],
      clarifications: ['sensitive clarification'],
    },
  };
  mocks.pass1.mockResolvedValue({
    output: pass1Output,
    callLog: callLog('PASS_1_TRANSCRIBE_AND_ANALYSE'),
  });
  mocks.passPlanDictation.mockResolvedValue({
    output: pass14Output,
    callLog: callLog('PASS_14_PLAN_DICTATION'),
  });
});

describe('plan dictation current authority boundaries', () => {
  it('does not invoke Pass 1 and clears audio when authority is withdrawn before the model call', async () => {
    const audioBytes = Buffer.from([1, 2, 3, 4]);
    mocks.assertAuthority.mockRejectedValueOnce(new Error('authority denied'));

    await expect(
      transcribePlanCommand({
        sessionId: 'session-1',
        psychologistId: 'psy-1',
        audioBytes,
        durationMs: 1_000,
      }),
    ).rejects.toThrow('authority denied');

    expect(mocks.pass1).not.toHaveBeenCalled();
    expect(audioBytes.equals(Buffer.alloc(audioBytes.length))).toBe(true);
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
  });

  it('drops Pass 1 output when authority is withdrawn before persistence', async () => {
    const audioBytes = Buffer.from([1, 2, 3, 4]);
    mocks.assertAuthority
      .mockResolvedValueOnce({ psychologistId: 'psy-1' })
      .mockRejectedValueOnce(new Error('authority denied'));

    await expect(
      transcribePlanCommand({
        sessionId: 'session-1',
        psychologistId: 'psy-1',
        audioBytes,
        durationMs: 1_000,
      }),
    ).rejects.toThrow('authority denied');

    expect(mocks.pass1).toHaveBeenCalledOnce();
    expect(mocks.assertAuthority.mock.calls.map(([, boundary]) => boundary.source)).toEqual([
      'planDictationPass1BeforeModel',
      'planDictationPass1BeforePersistence',
    ]);
    expect(pass1Output).toEqual({
      transcript: '',
      speakerSegments: [],
      affectFeatures: [],
      detectedLanguages: [],
    });
    expect(audioBytes.equals(Buffer.alloc(audioBytes.length))).toBe(true);
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
  });

  it('does not invoke Pass 14 when authority is withdrawn before the model call', async () => {
    mocks.assertAuthority.mockRejectedValueOnce(new Error('authority denied'));

    await expect(
      runPlanDictation({
        sessionId: 'session-1',
        psychologistId: 'psy-1',
        command: 'add rest advice',
        rxPad: { version: 'V1' },
        language: 'en',
      }),
    ).rejects.toThrow('authority denied');

    expect(mocks.passPlanDictation).not.toHaveBeenCalled();
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
  });

  it('drops Pass 14 output when authority is withdrawn before persistence', async () => {
    mocks.assertAuthority
      .mockResolvedValueOnce({ psychologistId: 'psy-1' })
      .mockRejectedValueOnce(new Error('authority denied'));

    await expect(
      runPlanDictation({
        sessionId: 'session-1',
        psychologistId: 'psy-1',
        command: 'add rest advice',
        rxPad: { version: 'V1' },
        language: 'en',
      }),
    ).rejects.toThrow('authority denied');

    expect(mocks.passPlanDictation).toHaveBeenCalledOnce();
    expect(mocks.assertAuthority.mock.calls.map(([, boundary]) => boundary.source)).toEqual([
      'planDictationPass14BeforeModel',
      'planDictationPass14BeforePersistence',
    ]);
    expect(pass14Output.dictation.edits).toEqual([]);
    expect(pass14Output.dictation.clarifications).toEqual([]);
    expect(mocks.callLogCreate).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('sensitive');
  });
});
