'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MedicalEncounterNoteV1 } from '@cureocity/contracts';
import { useScribeFetch } from '../components/app/ScribeTransport';
import {
  ScribeCodingResponseSchema,
  ScribeCodingSaveSchema,
  scribeCodingNoteIdentity,
  type ScribeCodingResponse,
  type ScribeCodingWorksheet,
} from './scribe-coding';

export async function scribeCodingNoteHash(note: MedicalEncounterNoteV1): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(scribeCodingNoteIdentity(note)),
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

type CodingState = {
  sessionId: string;
  data: ScribeCodingResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
};

async function readResponse(response: Response, sessionId: string): Promise<ScribeCodingResponse> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'The coding worksheet could not be loaded or saved.';
    throw new Error(message);
  }
  const parsed = ScribeCodingResponseSchema.safeParse(body);
  if (!parsed.success || (parsed.data.record && parsed.data.record.sessionId !== sessionId))
    throw new Error('The coding response could not be verified. Reload before continuing.');
  return parsed.data;
}

/** Explicit server persistence only; no PHI in browser storage or automatic write retries. */
export function useScribeCoding({
  sessionId,
  note,
  baseline,
  enabled,
  signed,
}: {
  sessionId: string;
  note: MedicalEncounterNoteV1;
  baseline: MedicalEncounterNoteV1;
  enabled: boolean;
  signed: boolean;
}) {
  const request = useScribeFetch();
  const [state, setState] = useState<CodingState>({
    sessionId,
    data: null,
    loading: false,
    saving: false,
    error: null,
  });
  const [noteHash, setNoteHash] = useState<{ identity: string; hash: string } | null>(null);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const identity = scribeCodingNoteIdentity(note);
  const baselineIdentity = scribeCodingNoteIdentity(baseline);
  const current = enabled && state.sessionId === sessionId ? state : null;
  const baselineChanged = Boolean(
    current?.data && scribeCodingNoteIdentity(current.data.draft.content) !== baselineIdentity,
  );

  useEffect(() => {
    let cancelled = false;
    if (enabled)
      void scribeCodingNoteHash(note)
        .then((hash) => {
          if (!cancelled) setNoteHash({ identity, hash });
        })
        .catch(() => {
          if (!cancelled) setNoteHash(null);
        });
    return () => {
      cancelled = true;
    };
  }, [identity, enabled, note]);

  const reload = useCallback(async () => {
    if (!enabled || writing.current) return;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState((previous) => ({
      sessionId,
      data: previous.sessionId === sessionId ? previous.data : null,
      loading: true,
      saving: false,
      error: null,
    }));
    try {
      const response = await request(`/api/v1/scribe/encounters/${sessionId}/coding`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      const data = await readResponse(response, sessionId);
      if (operation === generation.current && !controller.signal.aborted)
        setState({ sessionId, data, loading: false, saving: false, error: null });
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load the coding worksheet.',
        }));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [enabled, request, sessionId]);

  useEffect(() => {
    if (enabled) void reload();
    return () => {
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
      writing.current = false;
    };
  }, [enabled, reload, signed]);

  async function save(worksheet: ScribeCodingWorksheet): Promise<ScribeCodingResponse | null> {
    if (
      !current?.data ||
      current.loading ||
      signed ||
      current.data.signed ||
      baselineChanged ||
      writing.current
    )
      return null;
    const parsed = ScribeCodingSaveSchema.safeParse({
      expectedRevision: current.data.record?.revision ?? 0,
      draftHash: current.data.draft.hash,
      workingNote: note,
      worksheet,
    });
    if (!parsed.success) {
      setState((previous) => ({
        ...previous,
        error: parsed.error.issues[0]?.message ?? 'Review the coding worksheet fields.',
      }));
      return null;
    }
    writing.current = true;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState((previous) => ({ ...previous, saving: true, error: null }));
    try {
      const expectedNoteHash = await scribeCodingNoteHash(note);
      if (operation !== generation.current || controller.signal.aborted) return null;
      const response = await request(`/api/v1/scribe/encounters/${sessionId}/coding`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const data = await readResponse(response, sessionId);
      const record = data.record;
      if (
        !record ||
        record.revision !== parsed.data.expectedRevision + 1 ||
        record.body.draftHash !== parsed.data.draftHash ||
        JSON.stringify(record.body.worksheet) !== JSON.stringify(parsed.data.worksheet) ||
        (worksheet.status === 'reviewed' && record.body.reviewedNoteHash !== expectedNoteHash)
      )
        throw new Error('The saved coding worksheet was not confirmed. Reload to check its state.');
      if (operation !== generation.current || controller.signal.aborted) return null;
      setState({ sessionId, data, loading: false, saving: false, error: null });
      return data;
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          saving: false,
          error:
            error instanceof Error && error.name !== 'TimeoutError'
              ? error.message
              : 'Saving was not confirmed. Your edits remain here; reload to check before retrying.',
        }));
      return null;
    } finally {
      if (operation === generation.current) writing.current = false;
      if (pending.current === controller) pending.current = null;
    }
  }

  return {
    state: current?.data ?? null,
    loading: enabled && (current === null || current.loading),
    saving: current?.saving ?? false,
    error: current?.error ?? null,
    currentNoteHash: noteHash?.identity === identity ? noteHash.hash : null,
    baselineChanged,
    reload,
    save,
  };
}
