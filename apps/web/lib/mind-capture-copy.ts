/** Matches the capture route, not the remembered preference for another mode. */
export function mindCaptureRetentionCopy({
  mode,
  method,
  capture,
}: {
  mode: 'live-capture' | 'dictation' | 'upload';
  method: string;
  capture: 'live' | 'batch';
}): string {
  if (mode === 'live-capture' && method === 'mic' && capture === 'live') {
    return 'Live scribe streams audio for transcription but does not keep an audio recording for replay. Review the saved text; missing speech cannot be recovered from a recording.';
  }
  return 'Recorded or uploaded audio is saved for processing and recovery, then deleted under the practice’s retention settings and any agreed extension. Keep the session open until the recording and note saves are confirmed.';
}
