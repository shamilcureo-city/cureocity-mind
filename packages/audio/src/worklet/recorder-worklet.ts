/**
 * AudioWorkletProcessor for ambient session capture.
 *
 * Runs on the audio rendering thread (NOT the main thread, NOT a worker).
 * Receives raw Float32 frames from getUserMedia at 48 kHz mono, posts
 * them upstream via this.port. The main thread decimates to 16 kHz and
 * persists; we do NOT do decimation in-worklet to keep the audio thread
 * jitter-free.
 *
 * Lifecycle:
 *   - Constructed by `audioWorklet.addModule(...)` + `new AudioWorkletNode`
 *   - process() called every ~128 samples (~2.67 ms at 48 kHz)
 *   - Posts { type: 'frames', samples: Float32Array, capturedAt } per call
 *   - Main thread sends { type: 'stop' } via port to halt
 *
 * IMPORTANT: This file is NOT bundled with the rest of @cureocity/audio.
 * It is served as a standalone ES module to AudioWorklet.addModule().
 * The package.json `exports['./worklet']` entry points to the source so
 * the host app (therapist-web) can copy it into /public at build time.
 *
 * NOT VERIFIED in this repo's tests — AudioWorkletGlobalScope isn't a
 * thing in vitest/node. Smoke-tested in a real browser in Sprint 7 PR 5.
 */

// AudioWorkletProcessor + registerProcessor are globals in AudioWorkletGlobalScope.
// TypeScript doesn't ship lib.audioworklet.d.ts in the standard libs, so we
// declare just enough to compile this file.
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (): AudioWorkletProcessor;
};
interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

interface FramesMessage {
  type: 'frames';
  samples: Float32Array;
  capturedAt: number;
}

interface StopMessage {
  type: 'stop';
}

class CureocityRecorderProcessor extends AudioWorkletProcessor {
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<StopMessage>) => {
      if (e.data.type === 'stop') this.stopped = true;
    };
  }

  override process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    // Single-channel capture — input[0] is the mic mono stream.
    // Copy out of the worklet's transferable buffer so the message
    // doesn't get reused next tick.
    const samples = new Float32Array(input[0]);
    const msg: FramesMessage = {
      type: 'frames',
      samples,
      capturedAt: Date.now(),
    };
    this.port.postMessage(msg, [samples.buffer]);
    return true;
  }
}

registerProcessor('cureocity-recorder', CureocityRecorderProcessor);
