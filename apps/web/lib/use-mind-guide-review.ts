'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MindGuideStep } from './mind-guidance';
import {
  createGuideReviewQueue,
  readGuideReview,
  sameGuideReviewSnapshot,
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
  // Reading is immediate. Markers reflect acknowledged checkpoints only.
  const [cursor, setCursor] = useState<Cursor>({ activeIndex: 0, reviewedIndexes: [] });
  const current = useRef(cursor);
  const desired = useRef(cursor);
  const [saveStatus, setSaveStatus] = useState<Status>(target ? 'loading' : 'local');
  const state = useRef({
    generation: 0,
    revision: 0,
    hydrated: !target,
    sequence: 0,
    navigated: false,
    pending: false,
  });
  const lastAttempt = useRef<{ snapshot: MindGuideReviewSnapshot; revision: number } | null>(null);
  const request = useRef<AbortController | null>(null);
  const queue = useRef<ReturnType<typeof createGuideReviewQueue<MindGuideReviewSnapshot>> | null>(
    null,
  );
  const url = target
    ? '/api/v1/clients/' +
      encodeURIComponent(target.clientId) +
      '/therapy-scripts/' +
      encodeURIComponent(target.scriptId) +
      '/review'
    : null;
  const version = target?.scriptUpdatedAt ?? '';
  const stepCount = steps.length;

  const checkpoint = useCallback(
    (next: Cursor) => {
      desired.current = next;
      if (!url || !state.current.hydrated || !queue.current) return;
      const sequence = ++state.current.sequence;
      const generation = state.current.generation;
      state.current.pending = true;
      setSaveStatus('saving');
      const snapshot: MindGuideReviewSnapshot = { version: 1, scriptUpdatedAt: version, ...next };
      void queue
        .current(snapshot)
        .then(() => {
          if (generation === state.current.generation && sequence === state.current.sequence) {
            state.current.pending = false;
            setSaveStatus('saved');
          }
        })
        .catch((error: unknown) => {
          if (generation !== state.current.generation) return;
          state.current.hydrated = false;
          state.current.pending = false;
          setSaveStatus(error instanceof ProgressError ? error.status : 'save-error');
        });
    },
    [url, version],
  );

  const load = useCallback(
    (retry = false) => {
      request.current?.abort();
      queue.current?.cancel();
      const generation = ++state.current.generation;
      const retryRevision = state.current.revision;
      const attempt = lastAttempt.current;
      state.current.hydrated = !url;
      state.current.pending = false;
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
        const expectedRevision = state.current.revision;
        lastAttempt.current = { snapshot, revision: expectedRevision };
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
        if (
          !saved ||
          saved.revision !== expectedRevision + 1 ||
          !sameGuideReviewSnapshot(saved, snapshot)
        )
          throw new ProgressError('save-error');
        state.current.revision = saved.revision;
        current.current = { ...current.current, reviewedIndexes: saved.reviewedIndexes };
        setCursor(current.current);
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
          // A lost response may have committed. Retry only against the old revision
          // or that exact checkpoint, never over another view's changed markers.
          const safeRetry =
            !retry ||
            body.revision === retryRevision ||
            Boolean(
              restored &&
              attempt &&
              restored.revision === attempt.revision + 1 &&
              sameGuideReviewSnapshot(restored, attempt.snapshot),
            );
          const savedCursor = restored ?? { activeIndex: 0, reviewedIndexes: [] };
          const next = {
            activeIndex: state.current.navigated
              ? current.current.activeIndex
              : savedCursor.activeIndex,
            reviewedIndexes: savedCursor.reviewedIndexes,
          };
          current.current = next;
          setCursor(next);
          if (!safeRetry) {
            setSaveStatus('conflict');
            return;
          }
          state.current.revision = body.revision;
          state.current.hydrated = true;
          const pending = retry ? { ...desired.current, activeIndex: next.activeIndex } : next;
          desired.current = pending;
          const snapshot = { version: 1 as const, scriptUpdatedAt: version, ...pending };
          if (
            !sameGuideReviewSnapshot(snapshot, {
              version: 1,
              scriptUpdatedAt: version,
              ...savedCursor,
            })
          )
            checkpoint(pending);
          else setSaveStatus(restored ? 'saved' : 'ready');
        })
        .catch(() => {
          if (!controller.signal.aborted && generation === state.current.generation) {
            if (retry) setSaveStatus('save-error');
            else setSaveStatus('load-error');
          }
        });
    },
    [url, version, stepCount, checkpoint],
  );

  useEffect(() => {
    const initial = { activeIndex: 0, reviewedIndexes: [] };
    current.current = initial;
    desired.current = initial;
    state.current.navigated = false;
    state.current.revision = 0;
    lastAttempt.current = null;
    setCursor(initial);
    load();
    return () => {
      state.current.generation++;
      state.current.hydrated = false;
      request.current?.abort();
      queue.current?.cancel();
    };
  }, [load]);

  function setActiveIndex(value: number | ((previous: number) => number)) {
    const index = typeof value === 'function' ? value(current.current.activeIndex) : value;
    const activeIndex = Math.max(0, Math.min(stepCount - 1, index));
    if (activeIndex === current.current.activeIndex) return;
    state.current.navigated = true;
    current.current = { ...current.current, activeIndex };
    setCursor(current.current);
    checkpoint({ ...desired.current, activeIndex });
  }
  const canEdit = ['local', 'ready', 'saved'].includes(saveStatus);
  function toggleReviewed() {
    if (!state.current.hydrated || state.current.pending || !canEdit) return;
    const indexes = new Set(current.current.reviewedIndexes);
    const index = current.current.activeIndex;
    if (indexes.has(index)) indexes.delete(index);
    else indexes.add(index);
    const next = { ...current.current, reviewedIndexes: [...indexes].sort((a, b) => a - b) };
    if (!url) {
      current.current = next;
      setCursor(next);
    }
    checkpoint(next);
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
    canEdit,
    reload: () => load(),
    retry: () => load(true),
  };
}
