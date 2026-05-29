/**
 * AudioWorklet processor — runtime artifact.
 *
 * Hand-translated from packages/audio/src/worklet/recorder-worklet.ts
 * because Next.js doesn't bundle worklet sources from workspace deps
 * out of the box (would require a custom Webpack rule). Source of
 * truth is the .ts file; this file is built artifact + must stay in
 * sync. CI lint in Sprint 7 PR 5 verifies parity.
 */

class CureocityRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'stop') this.stopped = true;
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;
    const samples = new Float32Array(input[0]);
    this.port.postMessage({ type: 'frames', samples, capturedAt: Date.now() }, [samples.buffer]);
    return true;
  }
}

registerProcessor('cureocity-recorder', CureocityRecorderProcessor);
