'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  type ReactNode,
} from 'react';

export type MindCloseoutTask = 'work' | 'agreements' | 'appointment' | 'support' | 'decisions';
/** Status only: never place clinical text, form values, or error payloads in this context. */
export type MindCloseoutTaskStatus = {
  dirty: boolean;
  busy: boolean;
  needsAttention: boolean;
  uncertain?: boolean;
};
export type MindCloseoutTaskReporter = (
  task: MindCloseoutTask,
  source: string,
  status: MindCloseoutTaskStatus | null,
) => void;
const Context = createContext<
  ((source: string, status: MindCloseoutTaskStatus | null) => void) | null
>(null);

export function MindCloseoutTaskBoundary({
  task,
  onStatusChange,
  children,
}: {
  task: MindCloseoutTask;
  onStatusChange: MindCloseoutTaskReporter;
  children: ReactNode;
}) {
  const report = useCallback(
    (source: string, status: MindCloseoutTaskStatus | null) => {
      onStatusChange(task, source, status);
    },
    [task, onStatusChange],
  );
  return <Context.Provider value={report}>{children}</Context.Provider>;
}

/** Outside closeout, this is a no-op. Hiding an editor does not remove its status. */
export function useMindCloseoutTaskStatus({
  dirty,
  busy,
  needsAttention,
  uncertain = false,
}: MindCloseoutTaskStatus) {
  const report = useContext(Context);
  const source = useId();
  const status = useMemo(
    () => ({ dirty, busy, needsAttention, uncertain }),
    [dirty, busy, needsAttention, uncertain],
  );
  useEffect(() => {
    report?.(source, status);
  }, [report, source, status]);
  useEffect(() => () => report?.(source, null), [report, source]);
}

export function summarizeMindCloseoutTaskStatus(
  sources: Record<string, MindCloseoutTaskStatus> = {},
): MindCloseoutTaskStatus {
  const values = Object.values(sources);
  return {
    dirty: values.some((value) => value.dirty),
    busy: values.some((value) => value.busy),
    needsAttention: values.some((value) => value.needsAttention),
    uncertain: values.some((value) => value.uncertain),
  };
}

export function sameMindCloseoutTaskStatus(
  left: MindCloseoutTaskStatus | undefined,
  right: MindCloseoutTaskStatus,
): boolean {
  return (
    !!left &&
    left.dirty === right.dirty &&
    left.busy === right.busy &&
    left.needsAttention === right.needsAttention &&
    !!left.uncertain === !!right.uncertain
  );
}
