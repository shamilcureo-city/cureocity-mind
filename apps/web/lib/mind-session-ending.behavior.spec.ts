import { describe, expect, it } from 'vitest';
import {
  beginFinalization,
  finalizationFailed,
  retryFinalization,
  transcriptDownload,
  type MindFinalizationState,
} from './mind-session-finalization';

describe('Mind session ending behavior', () => {
  it('requires confirmation and preserves the exact transcript through retry and rescue', () => {
    const recording: MindFinalizationState = {
      stage: 'recording',
      sessionId: 'session-1',
      transcript: 'Client: I slept better.\nTherapist: What helped?',
      notePayload: { note: 'Draft note' },
      error: null,
      serverGenerationStarted: true,
    };
    expect(() => beginFinalization(recording, false)).toThrow('Confirm that you intend');

    const stopping = beginFinalization(recording, true);
    expect(stopping.stage).toBe('stopping');
    const failed = finalizationFailed(stopping, 'generation unavailable');
    expect(failed.safeToLeave).toBe(true);
    expect(retryFinalization(failed)).toMatchObject({
      stage: 'stopping',
      transcript: recording.transcript,
      notePayload: recording.notePayload,
    });
    expect(transcriptDownload('session-1', failed.transcript).content).toBe(recording.transcript);
  });
});
