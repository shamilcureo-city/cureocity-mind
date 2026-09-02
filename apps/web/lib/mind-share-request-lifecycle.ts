import type { MindOutcomeCandidate } from './mind-care-loop';

export interface MindShareRequestIdentity {
  mindSessionId: string;
  clientId: string;
}

export type MindShareLoadState =
  | { status: 'closed'; requestIdentity: null }
  | {
      status: 'loading' | 'error' | 'empty' | 'invalid';
      requestIdentity: MindShareRequestIdentity;
    }
  | {
      status: 'ready';
      requestIdentity: MindShareRequestIdentity;
      candidates: MindOutcomeCandidate[];
    };

type MindShareRequestLifecycleOptions = {
  clearPhi: () => void;
  resetDeliveryIdentity: () => void;
  applyState: (state: MindShareLoadState) => void;
};

type LoadCandidates = (signal: AbortSignal) => Promise<unknown>;

function isCandidate(value: unknown): value is MindOutcomeCandidate {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MindOutcomeCandidate>;
  return (
    typeof candidate.label === 'string' &&
    Boolean(candidate.artefact) &&
    typeof candidate.artefact === 'object' &&
    typeof (candidate.artefact as { artefactType?: unknown }).artefactType === 'string'
  );
}

function sameIdentity(left: MindShareRequestIdentity, right: MindShareRequestIdentity): boolean {
  return left.mindSessionId === right.mindSessionId && left.clientId === right.clientId;
}

export function createMindShareRequestLifecycle({
  clearPhi,
  resetDeliveryIdentity,
  applyState,
}: MindShareRequestLifecycleOptions) {
  let requestId = 0;
  let activeRequest: AbortController | null = null;
  let state: MindShareLoadState = { status: 'closed', requestIdentity: null };

  const publish = (next: MindShareLoadState) => {
    state = next;
    applyState(next);
  };

  const invalidate = () => {
    requestId += 1;
    activeRequest?.abort();
    activeRequest = null;
  };

  return {
    transition(identity: MindShareRequestIdentity | null, load: LoadCandidates | null) {
      invalidate();
      clearPhi();
      resetDeliveryIdentity();
      if (!identity || !load) {
        publish({ status: 'closed', requestIdentity: null });
        return;
      }

      const transitionRequestId = requestId;
      const controller = new AbortController();
      activeRequest = controller;
      publish({ status: 'loading', requestIdentity: identity });

      void load(controller.signal).then(
        (value) => {
          if (transitionRequestId !== requestId || controller.signal.aborted) return;
          if (!Array.isArray(value) || !value.every(isCandidate)) {
            publish({ status: 'invalid', requestIdentity: identity });
            return;
          }
          if (value.length === 0) {
            publish({ status: 'empty', requestIdentity: identity });
            return;
          }
          publish({ status: 'ready', requestIdentity: identity, candidates: value });
        },
        () => {
          if (transitionRequestId !== requestId || controller.signal.aborted) return;
          publish({ status: 'error', requestIdentity: identity });
        },
      );
    },
    canSubmit(identity?: MindShareRequestIdentity) {
      return (
        state.status === 'ready' && (!identity || sameIdentity(state.requestIdentity, identity))
      );
    },
    assertCanSubmit(identity?: MindShareRequestIdentity) {
      if (
        state.status !== 'ready' ||
        (identity && !sameIdentity(state.requestIdentity, identity))
      ) {
        throw new Error('Sharing options are not ready.');
      }
      return state;
    },
    dispose() {
      invalidate();
    },
  };
}
