import { describe, expect, it } from 'vitest';
import { compactPassError, describePassError } from './pass-error';

// The real thing, trimmed: one drifted enum repeated across every quote.
const ZOD_DUMP = JSON.stringify(
  Array.from({ length: 12 }, (_, i) => ({
    received: 'Sajina',
    code: 'invalid_enum_value',
    options: ['client', 'therapist', 'unknown'],
    path: ['initialAssessmentBrief', 'differential', 0, 'supportingEvidence', i, 'speaker'],
    message: "Invalid enum value. Expected 'client' | 'therapist' | 'unknown', received 'Sajina'",
  })),
);

describe('describePassError', () => {
  it('leads with a sentence, not the Zod dump', () => {
    const out = describePassError(ZOD_DUMP, 'fallback');
    expect(out.summary).not.toContain('invalid_enum_value');
    expect(out.summary.length).toBeLessThan(300);
    expect(out.detail).toBe(ZOD_DUMP);
  });

  it('keeps a message that was already readable', () => {
    const msg = 'Vertex request timed out after 120s.';
    expect(describePassError(msg, 'fallback')).toEqual({ summary: msg, detail: null });
  });

  it('does not duplicate a readable message into the details fold', () => {
    expect(describePassError('Something broke.', 'fallback').detail).toBeNull();
  });

  it('falls back when there is no message at all', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(describePassError(empty, 'fallback')).toEqual({ summary: 'fallback', detail: null });
    }
  });

  it('leaves a long-but-human message alone', () => {
    // Length alone must not trigger the fold — only a message that actually
    // looks like serialised issues.
    const long = `Couldn't reach the model. ${'This is a plain sentence. '.repeat(20)}`;
    expect(describePassError(long, 'fallback').detail).toBeNull();
  });
});

describe('compactPassError — what a failure may look like AT REST', () => {
  it('never persists received values (the client-name incident)', () => {
    const out = compactPassError(ZOD_DUMP);
    expect(out).not.toContain('Sajina');
    expect(out).toContain('invalid_enum_value');
    expect(out).toContain('speaker');
    expect(out.length).toBeLessThanOrEqual(500);
  });

  it('keeps a hand-written message intact', () => {
    const msg = 'Transcription came back empty. Check your microphone.';
    expect(compactPassError(msg)).toBe(msg);
  });

  it('truncates an over-long plain message instead of storing megabytes', () => {
    const long = 'x'.repeat(5_000);
    expect(compactPassError(long).length).toBeLessThanOrEqual(500);
  });

  it('summarises distinct issue paths, not one per repetition', () => {
    const out = compactPassError(ZOD_DUMP);
    // 12 issues share one field shape — the summary names the count, not 12 paths.
    expect(out).toContain('12 issue(s)');
  });

  it('degrades safely on a dump-shaped but unparseable message', () => {
    const almost = '[{"code": "invalid_enum_value", "received": "Sajina", broken';
    expect(compactPassError(almost)).not.toContain('Sajina');
  });
});
