import { describe, expect, it } from 'vitest';
import { LiveGatewayEventSchema, type LiveGatewayEvent } from '@cureocity/contracts';
import { MockGeminiPass1Backend, MockGeminiPass2Backend } from '@cureocity/llm';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';
import type { WindowOptions } from './vad';

function pcm(ms: number, amplitude: number, sampleRate = 16_000): Buffer {
  const samples = Math.round((ms / 1000) * sampleRate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(amplitude, i * 2);
  return buf;
}

const SPEECH = 8_000;
const SILENCE = 0;

// Small windows keep the test fast + deterministic (no reliance on timers).
const OPTS: WindowOptions = {
  sampleRate: 16_000,
  frameMs: 20,
  threshold: 0.015,
  minWindowMs: 4_000,
  maxWindowMs: 8_000,
  silenceMs: 400,
};

function mockBackends(): LiveBackends {
  return {
    backend: 'mock',
    pass1: new MockGeminiPass1Backend(),
    pass2: new MockGeminiPass2Backend(),
  };
}

/** One "utterance" of audio: 5s of speech + a 0.5s pause. */
const BLOCK = Buffer.concat([pcm(5_000, SPEECH), pcm(500, SILENCE)]);

describe('LiveSession — incremental windowing + metering (DS0)', () => {
  it('emits schema-valid events, one utterance per window, and a final note + meter', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-live',
      'Cardiology',
      mockBackends(),
      (e) => {
        // Contracts-first: every event on the wire must validate.
        expect(LiveGatewayEventSchema.safeParse(e).success).toBe(true);
        events.push(e);
      },
      OPTS,
    );

    session.start();
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const utterancesMid = events.filter((e) => e.type === 'utterance');
    expect(utterancesMid.length).toBeGreaterThanOrEqual(3);
    // Utterances carry monotonic ids + non-decreasing time bounds.
    for (let i = 0; i < utterancesMid.length; i++) {
      const u = utterancesMid[i]!;
      if (u.type !== 'utterance') continue;
      expect(u.utterance.id).toBe(`u${i + 1}`);
      expect(u.utterance.tEndMs).toBeGreaterThanOrEqual(u.utterance.tStartMs);
    }

    // The note rail builds during the consult (not only at the end).
    expect(events.some((e) => e.type === 'note')).toBe(true);

    await session.finalize();

    const finals = events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);

    const meters = events.filter((e) => e.type === 'meter');
    expect(meters.length).toBeGreaterThan(0);
    const lastMeter = meters[meters.length - 1]!;
    if (lastMeter.type === 'meter') {
      expect(lastMeter.summary.windows).toBeGreaterThanOrEqual(3);
      expect(lastMeter.summary.pass1Calls).toBe(lastMeter.summary.windows);
      expect(lastMeter.summary.backend).toBe('mock');
      expect(Number.isInteger(lastMeter.summary.inputTokens)).toBe(true);
    }
  });

  it('keeps per-window transcription tokens flat — O(n), not O(n²)', async () => {
    const session = new LiveSession('sess-on', 'Cardiology', mockBackends(), () => {}, OPTS);
    session.start();
    // Five uniform utterances streamed in one shot.
    session.pushAudio(Buffer.concat([BLOCK, BLOCK, BLOCK, BLOCK, BLOCK]));
    await session.pump();

    const tokens = [...session.transcribeTokenSamples];
    expect(tokens.length).toBeGreaterThanOrEqual(4);
    const first = tokens[0]!;
    const last = tokens[tokens.length - 1]!;
    expect(first).toBeGreaterThan(0);
    // The whole point of DS0: the last window costs ~the same as the first.
    expect(Math.abs(last - first) / first).toBeLessThanOrEqual(0.2);

    session.dispose();
  });

  it('finalizes cleanly with no audio (no window ever closed)', async () => {
    const events: LiveGatewayEvent[] = [];
    const session = new LiveSession(
      'sess-empty',
      null,
      mockBackends(),
      (e) => events.push(e),
      OPTS,
    );
    session.start();
    await session.finalize();

    // No final note (nothing was transcribed) but the lifecycle still closes.
    expect(events.some((e) => e.type === 'status' && e.state === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'meter')).toBe(true);
    expect(events.some((e) => e.type === 'final')).toBe(false);
  });
});
