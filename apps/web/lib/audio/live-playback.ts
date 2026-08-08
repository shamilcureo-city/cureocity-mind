'use client';

/**
 * Cureocity Care — 24 kHz PCM playback queue (AC3, §4.5).
 *
 * Gemini Live returns 16-bit signed LE PCM at 24,000 Hz. It MUST be
 * played through an AudioContext created at 24 kHz — resampling the
 * output to 16 kHz produces audible chipmunk artifacts (a hard-won
 * gotcha from the source recipe). Chunks are scheduled back-to-back on
 * the context clock; barge-in (`interrupted`) flushes everything queued.
 */
export class LivePlayback {
  private ctx: AudioContext | null = null;
  private nextStartTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private onStateChange: ((speaking: boolean) => void) | undefined;
  private speakingUntil = 0;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(onStateChange?: (speaking: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext({ sampleRate: 24_000 });
      this.nextStartTime = 0;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Enqueue one base64 s16le@24k chunk from serverContent inlineData. */
  enqueueBase64(b64: string): void {
    const ctx = this.ensureCtx();
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.byteLength / 2),
    );
    if (samples.length === 0) return;

    const buffer = ctx.createBuffer(1, samples.length, 24_000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i]! / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((s) => s !== source);
    };

    this.speakingUntil = Math.max(
      this.speakingUntil,
      performance.now() + (this.nextStartTime - ctx.currentTime) * 1000,
    );
    this.onStateChange?.(true);
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(
      () => this.onStateChange?.(false),
      Math.max(0, this.speakingUntil - performance.now()) + 100,
    );
  }

  /**
   * True while the model's audio is (or has just been) playing. The mic is
   * gated on this to run HALF-DUPLEX: on a phone speaker the browser's echo
   * canceller cannot reference Web Audio API playback, so the model's own
   * voice leaks into the mic, Gemini transcribes it as the user, and the
   * model answers itself — an "AI talking to an AI" loop. Not sending mic
   * audio while it speaks breaks that loop. The 150 ms tail covers the
   * acoustic + AEC latency after the last sample.
   */
  isSpeaking(): boolean {
    // The tail must cover the OUTPUT pipeline latency (Web Audio →
    // speaker) plus room reverb — 150ms let the last words of every
    // utterance leak into the mic on speakerphone, which the browser AEC
    // cannot cancel for Web Audio playback.
    const outputLatencyMs = ((this.ctx?.outputLatency ?? 0) + (this.ctx?.baseLatency ?? 0)) * 1000;
    return performance.now() < this.speakingUntil + outputLatencyMs + 450;
  }

  /** Barge-in: drop everything queued (Gemini sent `interrupted`). */
  flush(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.nextStartTime = 0;
    this.speakingUntil = 0;
    this.onStateChange?.(false);
  }

  async close(): Promise<void> {
    this.flush();
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close();
    this.ctx = null;
  }
}
