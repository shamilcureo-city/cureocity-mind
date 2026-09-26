'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { parseScribeSourceSnapshot, type ScribeSourceSnapshot } from './scribe-source-review';

/** An explicit, read-only source view. Never stores clinical text in browser storage. */
export function useScribeSourceReview(sessionId: string, open: boolean, ready: boolean) {
  const [state, setState] = useState<{
    sessionId: string;
    source: ScribeSourceSnapshot | null;
    loading: boolean;
    error: string | null;
  }>({ sessionId, source: null, loading: false, error: null });
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!open || !ready) return;
    const request = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ sessionId, source: null, loading: true, error: null });
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/source-review`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      if (!response.ok)
        throw new Error('The saved source could not be loaded. Check access and retry.');
      const source = parseScribeSourceSnapshot(await response.json());
      if (!source)
        throw new Error('The saved source response could not be verified. Retry loading it.');
      if (request === generation.current && !controller.signal.aborted)
        setState({ sessionId, source, loading: false, error: null });
    } catch (error) {
      if (request === generation.current && !controller.signal.aborted)
        setState({
          sessionId,
          source: null,
          loading: false,
          error: error instanceof Error ? error.message : 'The saved source could not be loaded.',
        });
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [sessionId, open, ready]);

  useEffect(() => {
    if (open && ready) void reload();
    return () => {
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
    };
  }, [open, ready, reload]);

  // Hide the previous patient's/source generation before effects get a chance to run.
  const current = open && ready && state.sessionId === sessionId ? state : null;
  return {
    source: current?.source ?? null,
    loading: open && ready && (current === null || current.loading),
    error: current?.error ?? null,
    reload,
  };
}
