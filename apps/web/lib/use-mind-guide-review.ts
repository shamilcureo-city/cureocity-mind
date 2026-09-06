'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MindGuideStep } from './mind-guidance';
import {
  createGuideReviewQueue,
  readGuideReview,
  type MindGuideReviewSnapshot,
} from './mind-guide-review';

export interface MindGuideReviewTarget {
  clientId: string;
  scriptId: string;
  scriptUpdatedAt: string;
}
type Cursor = { activeIndex: number; reviewedIndexes: number[] };
type Status =
  | 'local'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'load-error'
  | 'save-error'
  | 'conflict'
  | 'stale';
class ProgressError extends Error {
  constructor(readonly status: 'save-error' | 'conflict' | 'stale') {
    super(status);
  }
}

export function useMindGuideReview(
  steps: readonly MindGuideStep[],
  target?: MindGuideReviewTarget,
) {
  const [cursor, setCursor] = useState<Cursor>({ activeIndex: 0, reviewedIndexes: [] });
  const current = useRef(cursor);
  const [saveStatus, setSaveStatus] = useState<Status>(target ? 'loading' : 'local');
  const state = useRef({ generation: 0, revision: 0, hydrated: !target, saving: false });
  const request = useRef<AbortController | null>(null);
  const queue = useRef<ReturnType<typeof createGuideReviewQueue<MindGuideReviewSnapshot>> | null>(
    null,
  );
  const url = target
    ? `/api/v1/clients/${encodeURIComponent(target.clientId)}/therapy-scripts/${encodeURIComponent(target.scriptId)}/review`
    : null;
  const version = target?.scriptUpdatedAt ?? '';
  const stepCount = steps.length;

  const reload = useCallback(() => {
    request.current?.abort();
    queue.current?.cancel();
    const generation = ++state.current.generation;
    state.current.hydrated = !url;
    state.current.saving = false;
    state.current.revision = 0;
    if (!url) {
      setSaveStatus('local');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSaveStatus('loading');
    queue.current = createGuideReviewQueue(async (snapshot: MindGuideReviewSnapshot) => {
      if (controller.signal.aborted || generation !== state.current.generation)
        throw new ProgressError('save-error');
      // Read the latest acknowledged revision when this write starts, not when queued.
      const expectedRevision = state.current.revision;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...snapshot, expectedRevision }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const body = (await response.json().catch(() => null)) as {
        progress?: unknown;
        code?: string;
      } | null;
      if (controller.signal.aborted || generation !== state.current.generation) return;
      if (response.status === 409)
        throw new ProgressError(body?.code === 'GUIDE_CHANGED' ? 'stale' : 'conflict');
      if (!response.ok) throw new ProgressError('save-error');
      const saved = readGuideReview(body?.progress, version, stepCount);
      if (!saved || saved.revision !== expectedRevision + 1) throw new ProgressError('save-error');
      state.current.revision = saved.revision;
    });
    void fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load progress.');
        const body = (await response.json()) as {
          progress: unknown;
          revision: number;
          scriptUpdatedAt: string;
        };
        if (controller.signal.aborted || generation !== state.current.generation) return;
        if (body.scriptUpdatedAt !== version) {
          setSaveStatus('stale');
          return;
        }
        const restored = readGuideReview(body.progress, version, stepCount);
        if (
          (!restored && body.progress !== null) ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0 ||
          body.revision !== (restored?.revision ?? 0)
        )
          throw new Error('Invalid saved progress.');
        const next = restored ?? { activeIndex: 0, reviewedIndexes: [] };
        current.current = next;
        setCursor(next);
        state.current.revision = body.revision;
        state.current.hydrated = true;
        setSaveStatus(restored ? 'saved' : 'ready');
      })
      .catch(() => {
        if (!controller.signal.aborted && generation === state.current.generation)
          setSaveStatus('load-error');
      });
  }, [url, version, stepCount]);

  useEffect(() => {
    const initial = { activeIndex: 0, reviewedIndexes: [] };
    current.current = initial;
    setCursor(initial);
    reload();
    return () => {
      state.current.generation++;
      state.current.hydrated = false;
      request.current?.abort();
      queue.current?.cancel();
    };
  }, [reload]);

  function change(next: Cursor) {
    // This synchronous ref also blocks a second click before React has rendered disabled controls.
    if (!state.current.hydrated || state.current.saving) return;
    current.current = next;
    setCursor(next);
    if (!url) return;
    state.current.saving = true;
    setSaveStatus('saving');
    const generation = state.current.generation;
    const snapshot: MindGuideReviewSnapshot = { version: 1, scriptUpdatedAt: version, ...next };
    void queue.current!(snapshot)
      .then(() => {
        if (generation !== state.current.generation) return;
        state.current.saving = false;
        setSaveStatus('saved');
      })
      .catch((error: unknown) => {
        if (generation !== state.current.generation) return;
        state.current.saving = false;
        state.current.hydrated = false;
        setSaveStatus(error instanceof ProgressError ? error.status : 'save-error');
      });
  }
  function setActiveIndex(value: number | ((previous: number) => number)) {
    const index = typeof value === 'function' ? value(current.current.activeIndex) : value;
    change({ ...current.current, activeIndex: Math.max(0, Math.min(stepCount - 1, index)) });
  }
  function toggleReviewed() {
    const indexes = new Set(current.current.reviewedIndexes);
    const index = current.current.activeIndex;
    if (indexes.has(index)) indexes.delete(index);
    else indexes.add(index);
    change({ ...current.current, reviewedIndexes: [...indexes].sort((a, b) => a - b) });
  }
  const reviewed = new Set(
    cursor.reviewedIndexes
      .map((index) => steps[index]?.id)
      .filter((id): id is string => Boolean(id)),
  );
  return {
    activeIndex: cursor.activeIndex,
    reviewed,
    setActiveIndex,
    toggleReviewed,
    saveStatus,
    canEdit: ['local', 'ready', 'saved'].includes(saveStatus),
    reload,
  };
}
