'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScribeFetch } from '../components/app/ScribeTransport';
import {
  DEFAULT_SCRIBE_NOTE_STYLE,
  ScribeNoteStyleResponseSchema,
  ScribeNoteStyleUpdateSchema,
  ScribeShortcutsResponseSchema,
  type ScribeNoteStyle,
  type ScribeShortcut,
  type ScribeShortcutRecord,
} from './scribe-personalization-contracts';

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.json();
  if (!response.ok)
    throw new Error((body as { error?: string }).error ?? 'Could not save your preferences.');
  return body;
}

/** No browser storage: preferences are scoped by the authenticated server user. */
export function useScribeShortcuts(enabled: boolean) {
  const request = useScribeFetch();
  const writingRef = useRef(false);
  const [records, setRecords] = useState<ScribeShortcutRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = ScribeShortcutsResponseSchema.parse(
        await responseJson(await request('/api/v1/scribe/shortcuts', { cache: 'no-store' })),
      );
      setRecords(result.records);
      setLoaded(true);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [request]);
  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);
  async function save(body: ScribeShortcut, existing?: ScribeShortcutRecord) {
    if (writingRef.current) return false;
    writingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await responseJson(
        await request(
          `/api/v1/scribe/shortcuts${existing ? `/${encodeURIComponent(existing.id)}` : ''}`,
          {
            method: existing ? 'PATCH' : 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(existing ? { revision: existing.revision, body } : body),
          },
        ),
      );
      await reload();
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      writingRef.current = false;
      setBusy(false);
    }
  }
  async function remove(record: ScribeShortcutRecord) {
    if (writingRef.current) return false;
    writingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await responseJson(
        await request(`/api/v1/scribe/shortcuts/${encodeURIComponent(record.id)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision: record.revision }),
        }),
      );
      await reload();
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      writingRef.current = false;
      setBusy(false);
    }
  }
  return { records, error, busy, loaded, reload, save, remove };
}

export function useScribeNoteStyle() {
  const request = useScribeFetch();
  const context = useRef(request);
  context.current = request;
  const writingRef = useRef(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState({
    request,
    style: DEFAULT_SCRIBE_NOTE_STYLE,
    revision: 0,
    loaded: false,
    busy: false,
    error: null as string | null,
  });
  const current = state.request === request ? state : null;
  const reload = useCallback(async () => {
    if (context.current !== request || writingRef.current) return;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    pending.current = controller;
    try {
      const result = ScribeNoteStyleResponseSchema.parse(
        await responseJson(
          await request('/api/v1/scribe/note-styles', {
            cache: 'no-store',
            signal,
          }),
        ),
      );
      if (operation !== generation.current || controller.signal.aborted) return;
      signal.throwIfAborted();
      setState({
        request,
        style: result.record?.body ?? DEFAULT_SCRIBE_NOTE_STYLE,
        revision: result.record?.revision ?? 0,
        loaded: true,
        busy: false,
        error: null,
      });
    } catch (reason) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          request,
          style: previous.request === request ? previous.style : DEFAULT_SCRIBE_NOTE_STYLE,
          revision: previous.request === request ? previous.revision : 0,
          loaded: previous.request === request && previous.loaded,
          busy: false,
          error: reason instanceof Error ? reason.message : 'Could not load your note style.',
        }));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [request]);
  useEffect(() => {
    void reload();
    const changed = () => {
      void reload();
    };
    window.addEventListener('scribe-note-style-changed', changed);
    return () => {
      window.removeEventListener('scribe-note-style-changed', changed);
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
      writingRef.current = false;
    };
  }, [reload]);
  async function save(body: ScribeNoteStyle) {
    if (context.current !== request || !current?.loaded || writingRef.current) return false;
    const parsed = ScribeNoteStyleUpdateSchema.safeParse({ revision: current.revision, body });
    if (!parsed.success) {
      setState((previous) => ({
        ...previous,
        error: 'Check every heading and retain all seven sections.',
      }));
      return false;
    }
    writingRef.current = true;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    pending.current = controller;
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const result = ScribeNoteStyleResponseSchema.parse(
        await responseJson(
          await request('/api/v1/scribe/note-styles', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify(parsed.data),
            signal,
          }),
        ),
      );
      if (
        !result.record ||
        result.record.revision !== parsed.data.revision + 1 ||
        JSON.stringify(result.record.body) !== JSON.stringify(parsed.data.body)
      )
        throw new Error(
          'Your note style save was not confirmed. Keep your preview and reload the saved style before retrying.',
        );
      if (operation !== generation.current || controller.signal.aborted) return false;
      signal.throwIfAborted();
      setState({
        request,
        style: result.record.body,
        revision: result.record.revision,
        loaded: true,
        busy: false,
        error: null,
      });
      window.dispatchEvent(new Event('scribe-note-style-changed'));
      return true;
    } catch (reason) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          busy: false,
          error:
            reason instanceof Error ? reason.message : 'Your note style save was not confirmed.',
        }));
      return false;
    } finally {
      if (operation === generation.current) writingRef.current = false;
      if (pending.current === controller) pending.current = null;
    }
  }
  return {
    style: current?.style ?? DEFAULT_SCRIBE_NOTE_STYLE,
    revision: current?.revision ?? 0,
    loaded: current?.loaded ?? false,
    busy: current?.busy ?? false,
    error: current?.error ?? null,
    save,
    reload,
  };
}
