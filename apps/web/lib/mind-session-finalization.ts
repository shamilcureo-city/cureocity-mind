export type MindFinalizationStage =
  | 'recording'
  | 'stopping'
  | 'saving-transcript'
  | 'generating-note'
  | 'ready'
  | 'failed';
export type MindFinalizationAction = 'RETRY_FINALIZATION' | 'SAVE_TRANSCRIPT' | 'RETURN_TO_TODAY';

export interface MindFinalizationState {
  stage: MindFinalizationStage;
  sessionId: string;
  transcript: string;
  notePayload: unknown;
  error: string | null;
  serverGenerationStarted: boolean;
  failedAt?: Exclude<MindFinalizationStage, 'recording' | 'ready' | 'failed'>;
  actions?: MindFinalizationAction[];
  safeToLeave?: boolean;
}

export class MindFinalizationError extends Error {
  constructor(
    readonly code: 'END_NOT_CONFIRMED',
    message: string,
  ) {
    super(message);
    this.name = 'MindFinalizationError';
  }
}

export function finalizationStageLabel(stage: MindFinalizationStage): string {
  const labels: Record<MindFinalizationStage, string> = {
    recording: 'Recording',
    stopping: 'Stopping capture…',
    'saving-transcript': 'Saving transcript…',
    'generating-note': 'Generating note…',
    ready: 'Ready to review',
    failed: 'Finalization needs attention',
  };
  return labels[stage];
}

export function beginFinalization(
  state: MindFinalizationState,
  intentionalConfirmation: boolean,
): MindFinalizationState {
  if (!intentionalConfirmation) {
    throw new MindFinalizationError(
      'END_NOT_CONFIRMED',
      'Confirm that you intend to end this session.',
    );
  }
  return { ...state, stage: 'stopping', error: null };
}

export function finalizationFailed(
  state: MindFinalizationState,
  error: string,
): MindFinalizationState {
  const failedAt =
    state.stage === 'stopping' ||
    state.stage === 'saving-transcript' ||
    state.stage === 'generating-note'
      ? state.stage
      : 'saving-transcript';
  return {
    ...state,
    stage: 'failed',
    failedAt,
    error,
    actions: ['RETRY_FINALIZATION', 'SAVE_TRANSCRIPT', 'RETURN_TO_TODAY'],
    safeToLeave: state.serverGenerationStarted,
  };
}

/** Retry resumes the failed step with the same browser-held payload. */
export function retryFinalization(state: MindFinalizationState): MindFinalizationState {
  return {
    ...state,
    stage: state.failedAt ?? 'saving-transcript',
    error: null,
    actions: undefined,
  };
}

export function preserveTranscriptOnModeSwitch(
  transcript: string,
  captureMode: 'LIVE' | 'BATCH',
): { captureMode: 'LIVE' | 'BATCH'; transcript: string } {
  return { captureMode, transcript };
}

export function transcriptDownload(
  sessionId: string,
  transcript: string,
): { filename: string; mimeType: string; content: string } {
  return {
    filename: `session-${sessionId}-transcript.txt`,
    mimeType: 'text/plain;charset=utf-8',
    content: transcript,
  };
}
