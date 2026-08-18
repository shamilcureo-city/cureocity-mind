import { describe, expect, it } from 'vitest';
import { MeterSummarySchema } from './live-encounter';

const valid = {
  sessionId: 'session-1',
  backend: 'vertex',
  windows: 1,
  pass1Calls: 1,
  pass2Calls: 1,
  inputTokens: 100,
  outputTokens: 50,
  costInr: 0.25,
  transcriptP50Ms: 100,
  transcriptP95Ms: 200,
  speechToTranscriptP50Ms: 500,
  speechToTranscriptP95Ms: 900,
  noteP50Ms: 300,
  noteP95Ms: 400,
  elapsedMs: 60_000,
};

describe('final live meter telemetry', () => {
  it('accepts bounded real spend and zero-cost mock telemetry', () => {
    expect(MeterSummarySchema.safeParse(valid).success).toBe(true);
    expect(MeterSummarySchema.safeParse({ ...valid, backend: 'mock', costInr: 0 }).success).toBe(
      true,
    );
  });

  it('rejects mock spend, unknown backends, non-finite values and database overflow', () => {
    expect(MeterSummarySchema.safeParse({ ...valid, backend: 'mock' }).success).toBe(false);
    expect(MeterSummarySchema.safeParse({ ...valid, backend: 'other' }).success).toBe(false);
    expect(
      MeterSummarySchema.safeParse({ ...valid, costInr: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
    expect(MeterSummarySchema.safeParse({ ...valid, inputTokens: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(MeterSummarySchema.safeParse({ ...valid, elapsedMs: 86_400_001 }).success).toBe(false);
  });
});
