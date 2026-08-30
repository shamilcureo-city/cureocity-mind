import { describe, expect, it } from 'vitest';
import {
  beginFinalization,
  finalizationFailed,
  finalizationStageLabel,
  preserveTranscriptOnModeSwitch,
  retryFinalization,
  transcriptDownload,
  type MindFinalizationState,
} from './mind-session-finalization';

const ready: MindFinalizationState = {
  stage: 'recording',
  sessionId: 'session-1',
  transcript: 'Therapist: Hello\nClient: I need help',
  notePayload: { summary: 'Session summary' },
  error: null,
  serverGenerationStarted: false,
};

describe('Mind session finalization', () => {
  it('moves through honest stopping, saving, generating and ready stages', () => {
    expect(finalizationStageLabel('stopping')).toBe('Stopping capture…');
    expect(finalizationStageLabel('saving-transcript')).toBe('Saving transcript…');
    expect(finalizationStageLabel('generating-note')).toBe('Generating note…');
    expect(finalizationStageLabel('ready')).toBe('Ready to review');
  });

  it('requires intentional end confirmation before finalization begins', () => {
    expect(() => beginFinalization(ready, false)).toThrowError(
      expect.objectContaining({ code: 'END_NOT_CONFIRMED' }),
    );
    expect(beginFinalization(ready, true)).toMatchObject({ stage: 'stopping' });
  });

  it('retry preserves the exact transcript and note payload instead of starting fresh', () => {
    const failed = finalizationFailed(
      { ...ready, stage: 'saving-transcript' },
      'Network unavailable',
    );
    const retried = retryFinalization(failed);
    expect(retried).toMatchObject({
      stage: 'saving-transcript',
      transcript: ready.transcript,
      notePayload: ready.notePayload,
      error: null,
    });
  });

  it('offers transcript rescue and safe return once processing fails', () => {
    const failed = finalizationFailed(
      { ...ready, stage: 'generating-note', serverGenerationStarted: true },
      'Timed out',
    );
    expect(failed.actions).toEqual(['RETRY_FINALIZATION', 'SAVE_TRANSCRIPT', 'RETURN_TO_TODAY']);
    expect(failed.safeToLeave).toBe(true);
  });

  it('builds a portable transcript download when finalization fails', () => {
    expect(transcriptDownload('session-1', ready.transcript)).toEqual({
      filename: 'session-session-1-transcript.txt',
      mimeType: 'text/plain;charset=utf-8',
      content: ready.transcript,
    });
  });

  it('switching capture mode explicitly carries the existing transcript', () => {
    expect(preserveTranscriptOnModeSwitch(ready.transcript, 'BATCH')).toEqual({
      captureMode: 'BATCH',
      transcript: ready.transcript,
    });
  });
});
