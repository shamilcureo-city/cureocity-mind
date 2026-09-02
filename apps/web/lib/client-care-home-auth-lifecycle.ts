export type ClientCareHomeLoad<T> = (signal: AbortSignal) => Promise<T>;

type ClientCareHomeAuthLifecycleOptions<T> = {
  clearHome: () => void;
  applyHome: (home: T) => void;
  applyError: () => void;
};

export function createClientCareHomeAuthLifecycle<T>({
  clearHome,
  applyHome,
  applyError,
}: ClientCareHomeAuthLifecycleOptions<T>) {
  let requestId = 0;
  let activeRequest: AbortController | null = null;

  const invalidateActiveRequest = () => {
    requestId += 1;
    activeRequest?.abort();
    activeRequest = null;
  };

  return {
    transition(loadHome: ClientCareHomeLoad<T> | null) {
      invalidateActiveRequest();
      clearHome();
      if (!loadHome) return;

      const transitionRequestId = requestId;
      const controller = new AbortController();
      activeRequest = controller;

      void loadHome(controller.signal).then(
        (home) => {
          if (transitionRequestId === requestId && !controller.signal.aborted) applyHome(home);
        },
        () => {
          if (transitionRequestId === requestId && !controller.signal.aborted) applyError();
        },
      );
    },
    dispose() {
      invalidateActiveRequest();
    },
  };
}
