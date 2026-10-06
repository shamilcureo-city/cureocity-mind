/** Local diagnostic only. No samples or speech leave this processor. */
class CureocityMicrophoneCheck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.stopped = false;
    this.renderedFrames = 0;
    this.epoch = 0;
    this.resetMeter();
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'stop') this.stopped = true;
      if (data?.type === 'reset' && Number.isSafeInteger(data.epoch)) {
        this.epoch = data.epoch;
        this.resetMeter();
      }
    };
  }

  resetMeter() {
    this.frames = 0;
    this.intervalFrames = 0;
    this.power = 0;
    this.peak = 0;
  }

  process(inputs, outputs) {
    // Never play the microphone through speakers, including after stop/limit.
    outputs.forEach((output) => output.forEach((channel) => channel.fill(0)));
    if (this.stopped) return false;
    const samples = inputs[0]?.[0];
    // Advance the safety cap even when the microphone has no input frames.
    this.renderedFrames += outputs[0]?.[0]?.length || samples?.length || 128;
    if (this.renderedFrames >= sampleRate * 8) {
      this.stopped = true;
      this.port.postMessage({ type: 'limit' });
      return false;
    }
    if (!samples?.length) return true;
    for (let index = 0; index < samples.length; index += 1) {
      this.power += samples[index] * samples[index];
      this.peak = Math.max(this.peak, Math.abs(samples[index]));
    }
    this.frames += samples.length;
    this.intervalFrames += samples.length;
    if (this.intervalFrames >= sampleRate / 20) {
      this.port.postMessage({
        type: 'meter',
        epoch: this.epoch,
        frames: this.frames,
        rms: Math.sqrt(this.power / this.intervalFrames),
        peak: this.peak,
      });
      this.intervalFrames = 0;
      this.power = 0;
      this.peak = 0;
    }
    return true;
  }
}

registerProcessor('cureocity-microphone-check', CureocityMicrophoneCheck);
