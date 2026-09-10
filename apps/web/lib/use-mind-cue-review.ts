'use client';

import { useEffect, useRef, useState } from 'react';
import type { TherapyReasoningV1 } from '@cureocity/contracts';
import {
  MindCueReviewListSchema,
  persistMindCueReview,
  reviewedCueIds,
  cueFingerprints,
  cueReviewKey,
  type MindCueReview,
  type MindCueReviewInput,
} from './mind-cue-review';

export function useMindCueReview(sessionId: string, reasoning: TherapyReasoningV1 | null) {
  const [stateSessionId, setStateSessionId] = useState(sessionId);
  const inScope = stateSessionId === sessionId;
  const [records, setRecords] = useState<MindCueReview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const recordsRef = useRef<MindCueReview[]>([]);
  const pendingRef = useRef<MindCueReviewInput | null>(null);
  const runningRef = useRef(false);
  const generation = useRef(0);
  const readSequence = useRef(0);
  const [fingerprints, setFingerprints] = useState<{
    sessionId: string;
    reasoning: TherapyReasoningV1 | null;
    values: Record<string, string>;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void cueFingerprints(reasoning)
      .then((values) => {
        if (active) setFingerprints({ sessionId, reasoning, values });
      })
      .catch(() => {
        if (active)
          setError(
            'This browser could not verify cue content. Keep safety cues visible and continue your own assessment.',
          );
      });
    return () => {
      active = false;
    };
  }, [reasoning, sessionId]);
  const currentFingerprints =
    fingerprints?.sessionId === sessionId && fingerprints.reasoning === reasoning
      ? fingerprints.values
      : {};

  async function reload() {
    if (runningRef.current || pendingRef.current) return;
    const attempt = generation.current;
    const read = ++readSequence.current;
    setLoaded(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(`/api/v1/sessions/${sessionId}/mind-cue-review`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const parsed = MindCueReviewListSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error();
      if (attempt !== generation.current || read !== readSequence.current) return;
      recordsRef.current = parsed.data.records;
      setRecords(parsed.data.records);
      setLabels(parsed.data.labels);
      setLoaded(true);
      setError(null);
    } catch {
      if (attempt === generation.current && read === readSequence.current)
        setError(
          'Cue history could not be loaded. Current safety cues stay visible. Retry history before marking a cue reviewed.',
        );
    } finally {
      clearTimeout(timeout);
    }
  }
  useEffect(() => {
    ++generation.current;
    recordsRef.current = [];
    pendingRef.current = null;
    runningRef.current = false;
    setStateSessionId(sessionId);
    setPendingId(null);
    setLoaded(false);
    setError(null);
    setFingerprints(null);
    setRecords([]);
    setLabels({});
    void reload();
    const focus = () => void reload();
    window.addEventListener('focus', focus);
    return () => {
      ++generation.current;
      window.removeEventListener('focus', focus);
    };
  }, [sessionId]);

  async function save(input: MindCueReviewInput) {
    if (runningRef.current) return;
    runningRef.current = true;
    ++readSequence.current;
    pendingRef.current = input;
    setPendingId(input.id);
    setError(null);
    const attempt = generation.current;
    try {
      const receipt = await persistMindCueReview(sessionId, input);
      if (attempt !== generation.current) return;
      const next = [
        ...recordsRef.current.filter(
          (record) => cueReviewKey(record.kind, record.id) !== cueReviewKey(input.kind, input.id),
        ),
        receipt,
      ];
      recordsRef.current = next;
      setRecords(next);
      pendingRef.current = null;
    } catch (reason) {
      if (attempt === generation.current)
        setError(
          reason instanceof Error ? reason.message : 'Cue review was not confirmed saved. Retry.',
        );
    } finally {
      if (attempt === generation.current) {
        runningRef.current = false;
        setPendingId(null);
      }
    }
  }
  function review(
    id: string,
    kind: MindCueReviewInput['kind'],
    state: MindCueReviewInput['state'],
  ) {
    if (!inScope || !loaded || pendingRef.current || runningRef.current) return;
    const previous = recordsRef.current.find((record) => record.id === id && record.kind === kind);
    const fingerprint =
      state === 'reopened' ? previous?.fingerprint : currentFingerprints[cueReviewKey(kind, id)];
    if (!fingerprint) {
      setError('This cue is being verified or has changed. Keep it visible and try again.');
      return;
    }
    void save({
      id,
      kind,
      state,
      fingerprint,
      operationId: crypto.randomUUID(),
      expectedRevision: previous?.operationId ?? null,
    });
  }
  return {
    records: inScope ? records : [],
    labels: inScope ? labels : {},
    loaded: inScope && loaded,
    error: inScope ? error : null,
    pendingId: inScope ? pendingId : null,
    // During unknown history, do not clear safety by assuming older marks.
    resolvedIds:
      inScope && loaded ? reviewedCueIds(records, currentFingerprints) : new Set<string>(),
    review,
    retry: () => {
      if (inScope) return pendingRef.current ? void save(pendingRef.current) : void reload();
    },
    reload: () => {
      if (inScope && !runningRef.current) {
        pendingRef.current = null;
        void reload();
      }
    },
    blocked: !inScope || !loaded || pendingRef.current !== null,
  };
}
