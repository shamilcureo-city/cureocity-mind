'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { useScribeFetch } from '../components/app/ScribeTransport';
import { canonicalJson } from './sign-note-payload';
import {
  ScribeDoctorTemplateSchema,
  ScribeDoctorTemplatesResponseSchema,
  ScribeDoctorTemplateResponseSchema,
  ScribeDoctorTemplateCreateSchema,
  ScribeDoctorTemplateUpdateSchema,
  ScribeDoctorTemplateDeleteSchema,
  ScribeDoctorTemplateDeleteResponseSchema,
  type ScribeDoctorTemplate,
  type ScribeDoctorTemplateRecord,
} from './scribe-doctor-templates';

type State = {
  request: typeof fetch;
  active: boolean;
  records: ScribeDoctorTemplateRecord[];
  loaded: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
};

function emptyState(request: typeof fetch): State {
  return {
    request,
    active: false,
    records: [],
    loaded: false,
    loading: false,
    busy: false,
    error: null,
  };
}

function assertPersonal(record: ScribeDoctorTemplateRecord): void {
  if (record.clientId !== null || record.sessionId !== null)
    throw new Error(
      'The private template response could not be verified. Reload before continuing.',
    );
}

/** Preference-only create identity, shared with the server; no patient context is copied here. */
export async function scribeDoctorTemplateHash(template: ScribeDoctorTemplate): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(ScribeDoctorTemplateSchema.parse(template)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readResponse<T>(
  response: Response,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'The private template request could not be completed.',
    );
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      'The private template response could not be verified. Reload before continuing.',
    );
  return parsed.data;
}

/** Private preferences only. No clinical auto-capture, browser storage, events or automatic retries. */
export function useScribeDoctorTemplates(enabled: boolean) {
  const request = useScribeFetch();
  const [state, setState] = useState<State>(() => emptyState(request));
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const pendingCreate = useRef<{ identity: string; operationId: string } | null>(null);
  const context = useRef({ enabled, request });
  context.current = { enabled, request };
  const current = enabled && state.active && state.request === request ? state : null;

  const reload = useCallback(async () => {
    if (
      !enabled ||
      !context.current.enabled ||
      context.current.request !== request ||
      writing.current
    )
      return;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    pending.current = controller;
    setState((previous) => ({
      ...(previous.request === request && previous.active ? previous : emptyState(request)),
      active: true,
      loading: true,
      busy: false,
      error: null,
    }));
    try {
      const result = await readResponse(
        await request('/api/v1/scribe/templates', {
          cache: 'no-store',
          signal,
        }),
        ScribeDoctorTemplatesResponseSchema,
      );
      result.records.forEach(assertPersonal);
      signal.throwIfAborted();
      if (new Set(result.records.map((record) => record.id)).size !== result.records.length)
        throw new Error(
          'The private template response contains repeated records. Reload before continuing.',
        );
      if (operation === generation.current && !controller.signal.aborted) {
        // A confirmed reload establishes the library before a new create intent. Failed or
        // superseded reads must leave an uncertain create's retry identity intact.
        pendingCreate.current = null;
        setState({
          request,
          active: true,
          records: result.records,
          loaded: true,
          loading: false,
          busy: false,
          error: null,
        });
      }
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load private templates.',
        }));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [enabled, request]);

  useEffect(() => {
    context.current = { enabled, request };
    if (enabled) void reload();
    else setState(emptyState(request));
    return () => {
      if (context.current.request === request && context.current.enabled === enabled)
        context.current = { enabled: false, request };
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
      pendingCreate.current = null;
      writing.current = false;
    };
  }, [enabled, reload, request]);

  async function mutate<T>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body: unknown,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    confirm: (result: T) => ScribeDoctorTemplateRecord[] | Promise<ScribeDoctorTemplateRecord[]>,
  ): Promise<T | null> {
    if (
      !context.current.enabled ||
      context.current.request !== request ||
      !current?.loaded ||
      current.loading ||
      writing.current
    )
      return null;
    writing.current = true;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    pending.current = controller;
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const result = await readResponse(
        await request(url, {
          method,
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify(body),
          signal,
        }),
        schema,
      );
      if (operation !== generation.current || controller.signal.aborted) return null;
      signal.throwIfAborted();
      const records = await confirm(result);
      if (operation !== generation.current || controller.signal.aborted) return null;
      signal.throwIfAborted();
      setState({
        request,
        active: true,
        records,
        loaded: true,
        loading: false,
        busy: false,
        error: null,
      });
      return result;
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          busy: false,
          error:
            error instanceof Error && error.name !== 'TimeoutError'
              ? error.message
              : 'The change was not confirmed. Your saved templates are unchanged here; reload to check before retrying.',
        }));
      return null;
    } finally {
      if (operation === generation.current) writing.current = false;
      if (pending.current === controller) pending.current = null;
    }
  }

  /** UI must obtain the explicit contains-no-patient-data acknowledgement before calling save. */
  async function save(
    template: ScribeDoctorTemplate,
    existing?: ScribeDoctorTemplateRecord,
  ): Promise<ScribeDoctorTemplateRecord | null> {
    if (
      !context.current.enabled ||
      context.current.request !== request ||
      !current?.loaded ||
      current.loading ||
      writing.current
    )
      return null;
    const parsed = ScribeDoctorTemplateSchema.safeParse(template);
    if (!parsed.success) {
      setState((previous) => ({
        ...previous,
        error: 'Check the template name and allowed presentation or prompt fields.',
      }));
      return null;
    }
    const stored = existing ? current.records.find((record) => record.id === existing.id) : null;
    if (existing && (!stored || stored.revision !== existing.revision)) {
      setState((previous) => ({
        ...previous,
        error: 'This template changed. Reload and review before saving.',
      }));
      return null;
    }
    const identity = canonicalJson(parsed.data);
    if (!stored && pendingCreate.current?.identity !== identity)
      pendingCreate.current = { identity, operationId: crypto.randomUUID() };
    const operationId = stored?.body.operationId ?? pendingCreate.current!.operationId;
    const body = stored
      ? ScribeDoctorTemplateUpdateSchema.parse({
          revision: stored.revision,
          template: parsed.data,
          containsNoPatientData: true,
        })
      : ScribeDoctorTemplateCreateSchema.parse({
          operationId,
          template: parsed.data,
          containsNoPatientData: true,
        });
    const result = await mutate(
      `/api/v1/scribe/templates${stored ? `/${encodeURIComponent(stored.id)}` : ''}`,
      stored ? 'PATCH' : 'POST',
      body,
      ScribeDoctorTemplateResponseSchema,
      async (ack) => {
        const record = ack.record;
        assertPersonal(record);
        const alreadyKnown = current.records.find((row) => row.id === record.id);
        if (
          record.body.operationId !== operationId ||
          (stored &&
            (canonicalJson(record.body.template) !== identity ||
              record.body.createHash !== stored.body.createHash ||
              record.createdAt !== stored.createdAt ||
              record.id !== stored.id ||
              record.revision !== stored.revision + 1)) ||
          (!stored &&
            (record.body.createHash !== (await scribeDoctorTemplateHash(parsed.data)) ||
              (record.revision === 1 && canonicalJson(record.body.template) !== identity))) ||
          (!stored &&
            alreadyKnown &&
            (record.revision < alreadyKnown.revision ||
              record.body.operationId !== alreadyKnown.body.operationId ||
              record.body.createHash !== alreadyKnown.body.createHash ||
              record.createdAt !== alreadyKnown.createdAt))
        )
          throw new Error('The template save was not confirmed. Reload to check its saved state.');
        return [record, ...current.records.filter((row) => row.id !== record.id)];
      },
    );
    if (result && !stored && pendingCreate.current?.operationId === operationId)
      pendingCreate.current = null;
    return result?.record ?? null;
  }

  async function remove(record: ScribeDoctorTemplateRecord): Promise<boolean> {
    if (
      !context.current.enabled ||
      context.current.request !== request ||
      !current?.loaded ||
      current.loading ||
      writing.current
    )
      return false;
    const stored = current.records.find((row) => row.id === record.id);
    if (!stored || stored.revision !== record.revision) {
      setState((previous) => ({
        ...previous,
        error: 'This template changed. Reload and review before deleting.',
      }));
      return false;
    }
    const result = await mutate(
      `/api/v1/scribe/templates/${encodeURIComponent(stored.id)}`,
      'DELETE',
      ScribeDoctorTemplateDeleteSchema.parse({ revision: stored.revision }),
      ScribeDoctorTemplateDeleteResponseSchema,
      (ack) => {
        if (ack.deletedId !== stored.id || ack.revision !== stored.revision)
          throw new Error(
            'The template deletion was not confirmed. Reload to check its saved state.',
          );
        return current.records.filter((row) => row.id !== stored.id);
      },
    );
    return result !== null;
  }

  return {
    records: current?.records ?? [],
    loaded: current?.loaded ?? false,
    loading: enabled && (current === null || current.loading),
    busy: current?.busy ?? false,
    error: current?.error ?? null,
    reload,
    save,
    remove,
  };
}
