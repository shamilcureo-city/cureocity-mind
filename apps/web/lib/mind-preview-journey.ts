/** Fictional UI fixture only. Never use this state as evidence of actual
 * capture, consent, persistence, signature or delivery. It performs no IO. */
export type PreviewCapturePhase = 'ready' | 'recording' | 'paused' | 'interrupted' | 'draft';
export interface MindPreviewJourney {
  consent: boolean;
  phase: PreviewCapturePhase;
}
export type MindPreviewEvent =
  | { type: 'consent'; value: boolean }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'interrupt' }
  | { type: 'finish' }
  | { type: 'reset' };

export const initialMindPreview: MindPreviewJourney = { consent: false, phase: 'ready' };

export function reduceMindPreview(
  state: MindPreviewJourney,
  event: MindPreviewEvent,
): MindPreviewJourney {
  switch (event.type) {
    case 'reset':
      return { ...initialMindPreview };
    case 'consent':
      return state.phase === 'ready' ? { ...state, consent: event.value } : state;
    case 'start':
      return state.phase === 'ready' && state.consent ? { ...state, phase: 'recording' } : state;
    case 'pause':
      return state.phase === 'recording' ? { ...state, phase: 'paused' } : state;
    case 'interrupt':
      return state.phase === 'recording' ? { ...state, phase: 'interrupted' } : state;
    case 'resume':
      return ['paused', 'interrupted'].includes(state.phase)
        ? { ...state, phase: 'recording' }
        : state;
    case 'finish':
      return ['recording', 'paused'].includes(state.phase) ? { ...state, phase: 'draft' } : state;
  }
}
