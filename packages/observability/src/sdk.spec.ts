import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initObservability } from './sdk';
import {
  recordAuditWrite,
  recordCostCircuitTrip,
  recordCostInr,
  recordCrisisFlag,
  recordGeminiCall,
  recordAudioChunkUpload,
} from './metrics';

describe('initObservability', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });
  beforeEach(() => {
    process.env['OTEL_DISABLED'] = 'true';
  });

  it('returns a no-op handle when OTEL_DISABLED=true', async () => {
    const handle = initObservability({ serviceName: 'test' });
    expect(handle.sdk).toBeNull();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns a no-op handle when opts.disabled=true even with env unset', async () => {
    delete process.env['OTEL_DISABLED'];
    const handle = initObservability({ serviceName: 'test', disabled: true });
    expect(handle.sdk).toBeNull();
    await handle.shutdown();
  });
});

describe('metric helpers (no-throw smoke)', () => {
  // The OTel API uses a no-op meter when no provider is registered, so
  // these calls should be safe even outside initObservability(). The
  // value here is catching shape regressions in the helper APIs.
  it('records each metric type without throwing', () => {
    expect(() => recordAuditWrite('CLIENT_CREATED', 'PSYCHOLOGIST')).not.toThrow();
    expect(() => recordCrisisFlag('high')).not.toThrow();
    expect(() =>
      recordGeminiCall({
        pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
        status: 'SUCCESS',
        region: 'asia-south1',
        durationMs: 1234,
      }),
    ).not.toThrow();
    expect(() =>
      recordCostInr({ service: 'gemini', durationLabel: 'pass1', inr: 1.5 }),
    ).not.toThrow();
    expect(() => recordAudioChunkUpload({ sampleRate: 16000, sizeBytes: 65536 })).not.toThrow();
    expect(() => recordCostCircuitTrip('session')).not.toThrow();
  });
});
