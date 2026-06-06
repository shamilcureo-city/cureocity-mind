import { describe, it, expect, vi } from 'vitest';
import { ModelRouter } from './model-router';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiPass3Backend,
  MockGeminiPass4Backend,
  MockGeminiPass5Backend,
} from './backends/mock-gemini.backend';
import { computeCostInr, FLASH_PRICING, PRO_PRICING, estimateAudioInputTokens } from './pricing';

describe('ModelRouter', () => {
  it('runs pass1, pass2, pass3, and pass4, invoking onCallLog for each', async () => {
    const onCallLog = vi.fn();
    const router = new ModelRouter({
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      pass3: new MockGeminiPass3Backend(),
      pass4: new MockGeminiPass4Backend(),
      pass5: new MockGeminiPass5Backend(),
      onCallLog,
    });

    const p1 = await router.pass1({
      sessionId: 's_1',
      audioBytes: Buffer.alloc(1024),
      durationMs: 30_000,
    });
    expect(p1.output.transcript).toContain('mock transcript');
    expect(p1.callLog.pass).toBe('PASS_1_TRANSCRIBE_AND_ANALYSE');
    expect(p1.callLog.region).toBe('mock-asia-south1');

    const p2 = await router.pass2({
      sessionId: 's_1',
      transcript: p1.output.transcript,
      speakerSegments: p1.output.speakerSegments,
      kind: 'TREATMENT',
      modality: 'CBT',
      clientContext: { presentingConcerns: 'anxiety' },
    });
    // Sprint 19 — Pass 2 output is a discriminated union; TREATMENT
    // sessions emit therapyNote, INTAKE sessions emit intakeNote.
    if (p2.output.kind !== 'TREATMENT') throw new Error('expected TREATMENT branch');
    expect(p2.output.therapyNote.version).toBe('V1');
    expect(p2.output.therapyNote.modality).toBe('CBT');

    const p3 = await router.pass3({
      sessionId: 's_1',
      transcript: p1.output.transcript,
      speakerSegments: p1.output.speakerSegments,
      kind: 'TREATMENT',
      modality: 'CBT',
      language: 'en',
      note: p2.output.therapyNote,
      clientContext: { presentingConcerns: 'anxiety' },
    });
    // Sprint 19 — Pass 3 output is also a discriminated union.
    if (p3.output.kind !== 'TREATMENT') throw new Error('expected TREATMENT branch');
    expect(p3.output.clinicalReport.version).toBe('V1');
    expect(p3.output.clinicalReport.diagnosisCandidates.length).toBeGreaterThan(0);
    expect(p3.callLog.pass).toBe('PASS_3_CLINICAL_ANALYSIS');

    const p4 = await router.pass4({
      therapyName: 'Cognitive Restructuring',
      language: 'en',
      primaryDiagnosis: { icd11Code: '6B00', icd11Label: 'Generalised anxiety disorder' },
    });
    expect(p4.output.therapyScript.version).toBe('V1');
    expect(p4.output.therapyScript.mainExercise.steps.length).toBeGreaterThan(0);
    expect(p4.output.therapyScript.therapyName).toBe('Cognitive Restructuring');
    expect(p4.callLog.pass).toBe('PASS_4_THERAPY_SCRIPT');

    expect(onCallLog).toHaveBeenCalledTimes(4);
  });

  it('mock Pass 1 returns detected languages (empty for plain runs)', async () => {
    const router = new ModelRouter({
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      pass3: new MockGeminiPass3Backend(),
      pass4: new MockGeminiPass4Backend(),
      pass5: new MockGeminiPass5Backend(),
    });
    const r = await router.pass1({
      sessionId: 's_lang_default',
      audioBytes: Buffer.alloc(1024),
      durationMs: 30_000,
    });
    expect(r.output.detectedLanguages).toEqual(['en']);
    expect(r.output.speakerSegments.every((s) => typeof s.language === 'string')).toBe(true);
  });

  it('mock Pass 1 emits a Manglish (ml + en) shape when hinted', async () => {
    const router = new ModelRouter({
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      pass3: new MockGeminiPass3Backend(),
      pass4: new MockGeminiPass4Backend(),
      pass5: new MockGeminiPass5Backend(),
    });
    const r = await router.pass1({
      sessionId: 's_lang_manglish',
      audioBytes: Buffer.alloc(1024),
      durationMs: 30_000,
      hints: { spokenLanguageHints: ['ml', 'en'] },
    });
    expect(r.output.detectedLanguages).toEqual(['ml', 'en']);
    const mixed = r.output.speakerSegments.find((s) => s.language === 'mixed');
    expect(mixed).toBeDefined();
  });

  it('mock Pass 4 honours spokenLanguage in the prompt-input layer', async () => {
    const router = new ModelRouter({
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      pass3: new MockGeminiPass3Backend(),
      pass4: new MockGeminiPass4Backend(),
      pass5: new MockGeminiPass5Backend(),
    });
    // The mock backend itself produces a deterministic English script,
    // but the routing layer must accept the new field without errors.
    const r = await router.pass4({
      therapyName: 'Behavioural Activation',
      language: 'en',
      spokenLanguage: 'ml',
    });
    expect(r.output.therapyScript.therapyName).toBe('Behavioural Activation');
  });

  it('works without onCallLog callback', async () => {
    const router = new ModelRouter({
      pass1: new MockGeminiPass1Backend(),
      pass2: new MockGeminiPass2Backend(),
      pass3: new MockGeminiPass3Backend(),
      pass4: new MockGeminiPass4Backend(),
      pass5: new MockGeminiPass5Backend(),
    });
    const result = await router.pass1({
      sessionId: 's_2',
      audioBytes: Buffer.alloc(1024),
      durationMs: 5_000,
    });
    expect(result.callLog.status).toBe('SUCCESS');
  });
});

describe('pricing.computeCostInr', () => {
  it('matches Flash pricing for a typical 50-minute session', () => {
    // 50 min audio = 50 * 60 * 32 = 96000 input tokens; assume 5000 output tokens
    const inr = computeCostInr(96_000, 5_000, FLASH_PRICING);
    // (96000 * 0.075 + 5000 * 0.30) / 1e6 USD = 0.0072 + 0.0015 = 0.0087 USD
    // ~0.72 INR — should be well under the ₹500/session cap
    expect(inr).toBeGreaterThan(0.5);
    expect(inr).toBeLessThan(2);
  });

  it('matches Pro pricing for a typical Pass 2', () => {
    // 10k input text tokens, 2k output
    const inr = computeCostInr(10_000, 2_000, PRO_PRICING);
    // (10000 * 1.25 + 2000 * 5) / 1e6 USD = 0.0125 + 0.01 = 0.0225 USD = ~1.87 INR
    expect(inr).toBeGreaterThan(1);
    expect(inr).toBeLessThan(3);
  });

  it('rounds to 4 fractional digits', () => {
    const inr = computeCostInr(100, 100, FLASH_PRICING);
    const fractional = String(inr).split('.')[1] ?? '';
    expect(fractional.length).toBeLessThanOrEqual(4);
  });
});

describe('pricing.estimateAudioInputTokens', () => {
  it('returns ~32 tokens per second of audio', () => {
    expect(estimateAudioInputTokens(1000)).toBe(32);
    expect(estimateAudioInputTokens(60_000)).toBe(60 * 32);
  });
});
