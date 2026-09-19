import type { TherapyReasoningV1 } from '@cureocity/contracts';

export type LiveSessionPhase =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'pausing'
  | 'paused'
  | 'pause-unconfirmed'
  | 'finalizing'
  | 'done'
  | 'error';

/**
 * Keep the live surface honest about both the microphone and the network.
 * "Recording" used to cover several materially different states; these labels
 * tell the psychologist whether speech is being heard, locally stopped, or
 * still waiting for a secure connection/last-frame confirmation.
 */
export function liveSessionCapturePresentation({
  phase,
  consentBlocked,
  reconnecting,
  connectionLost,
}: {
  phase: LiveSessionPhase;
  consentBlocked: boolean;
  reconnecting: boolean;
  connectionLost: boolean;
}): { status: string; detail: string } {
  if (consentBlocked)
    return {
      status: 'Paused',
      detail: 'Microphone off · Connection inactive. Confirm consent below before trying again.',
    };

  switch (phase) {
    case 'listening':
      return {
        status: 'Listening',
        detail:
          'Microphone on · Connected. Live transcription is running; keep this page open until saving is confirmed.',
      };
    case 'connecting':
      return {
        status: reconnecting ? 'Reconnecting' : 'Processing',
        detail:
          'Microphone setup in progress · Connection not yet confirmed. Wait for Listening before relying on live transcription.',
      };
    case 'pausing':
      return {
        status: 'Processing',
        detail:
          'Microphone off · Confirming the last captured audio. Do not continue speaking for the record yet.',
      };
    case 'paused':
      return {
        status: 'Paused',
        detail:
          'Microphone off · No new audio is captured. Resume rechecks the connection, access and consent.',
      };
    case 'pause-unconfirmed':
      return {
        status: 'Paused',
        detail:
          'Microphone off · Connection unconfirmed. Review the last captured words before continuing.',
      };
    case 'finalizing':
      return {
        status: 'Processing',
        detail:
          'Microphone off · Capture has stopped. The transcript and draft are being prepared for review.',
      };
    case 'done':
      return {
        status: 'Stopped',
        detail:
          'Microphone off · Capture stopped. Keep this page open until the transcript and note are confirmed saved.',
      };
    case 'error':
      return {
        status: 'Paused',
        detail: connectionLost
          ? 'Microphone off · Connection lost. Reconnect explicitly or recover the captured transcript below.'
          : 'Microphone off · Connection inactive. Resolve the issue below before trying again.',
      };
    case 'idle':
    default:
      return {
        status: 'Ready',
        detail: 'Microphone off · Connection inactive. Start only when the client is ready.',
      };
  }
}

/**
 * Risk remains persistent. Everything else advances as a single foreground
 * suggestion so the copilot cannot turn the room into a checklist. Live
 * questions take priority, then questions the psychologist prepared, then an
 * unexplored thread. Session pacing appears only when no other prompt leads.
 */
export function focusedLiveSessionReasoning(
  reasoning: TherapyReasoningV1 | null,
  mode: 'quiet' | 'guided',
  guideActive: boolean,
): TherapyReasoningV1 | null {
  if (!reasoning) return null;
  if (mode === 'quiet' || guideActive) return { ...reasoning, askNext: [], threads: [], arc: null };

  const liveQuestion = reasoning.askNext.find((item) => item.source !== 'CARRIED');
  const preparedQuestion = reasoning.askNext.find((item) => item.source === 'CARRIED');
  const question = liveQuestion ?? preparedQuestion;
  const thread = question ? undefined : reasoning.threads[0];
  return {
    ...reasoning,
    askNext: question ? [question] : [],
    threads: thread ? [thread] : [],
    arc: question || thread ? null : reasoning.arc,
  };
}
