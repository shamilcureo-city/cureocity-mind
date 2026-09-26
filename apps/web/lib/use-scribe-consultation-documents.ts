'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useScribeFetch } from '../components/app/ScribeTransport';
import {
  ScribeConsultationDocumentsResponseSchema,
  ScribeConsultationDocumentsCreateSchema,
  ScribeConsultationDocumentUpdateSchema,
  type ScribeConsultationDocumentsResponse,
  type ScribeConsultationDocumentType,
  type ScribeConsultationDocumentPacket,
  type ScribeConsultationDocument,
} from './scribe-consultation-documents';

type State = {
  scope: string;
  data: ScribeConsultationDocumentsResponse | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
};

/** Explicit persistence only. Clinical document text never enters browser storage. */
export function useScribeConsultationDocuments({
  clientId,
  sessionId,
  enabled,
}: {
  clientId: string;
  sessionId: string;
  enabled: boolean;
}) {
  const request = useScribeFetch();
  const scope = `${clientId}/${sessionId}`;
  const [state, setState] = useState<State>({
    scope,
    data: null,
    loading: enabled,
    busy: false,
    error: null,
  });
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const pendingCreate = useRef<{ identity: string; operationId: string } | null>(null);
  const current = enabled && state.scope === scope ? state : null;

  const readResponse = useCallback(
    async (response: Response): Promise<ScribeConsultationDocumentsResponse> => {
      const body: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'The document request could not be completed.',
        );
      const parsed = ScribeConsultationDocumentsResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.packets.some(
          (packet) =>
            packet.clientId !== clientId ||
            packet.sessionId !== sessionId ||
            packet.sourceCurrent !==
              (parsed.data.source.state === 'ready' &&
                packet.body.sourceHash === parsed.data.source.hash &&
                packet.body.noteId === parsed.data.source.noteId &&
                packet.body.signedAt === parsed.data.source.signedAt),
        )
      )
        throw new Error('The document response could not be verified. Reload before continuing.');
      return parsed.data;
    },
    [clientId, sessionId],
  );

  const reload = useCallback(async () => {
    if (!enabled || writing.current) return;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState((previous) => ({
      scope,
      data: previous.scope === scope ? previous.data : null,
      loading: true,
      busy: false,
      error: null,
    }));
    try {
      const response = await request(`/api/v1/scribe/encounters/${sessionId}/documents`, {
        cache: 'no-store',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
      });
      const data = await readResponse(response);
      if (operation === generation.current && !controller.signal.aborted)
        setState({ scope, data, loading: false, busy: false, error: null });
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not load consultation documents.',
        }));
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  }, [enabled, readResponse, request, scope, sessionId]);

  useEffect(() => {
    if (enabled) void reload();
    return () => {
      ++generation.current;
      pending.current?.abort();
      pending.current = null;
      pendingCreate.current = null;
      writing.current = false;
    };
  }, [enabled, reload]);

  async function mutate(
    url: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    verify: (data: ScribeConsultationDocumentsResponse) => boolean,
  ): Promise<ScribeConsultationDocumentsResponse | null> {
    if (!current?.data || current.loading || writing.current) return null;
    writing.current = true;
    const operation = ++generation.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const response = await request(url, {
        method,
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const data = await readResponse(response);
      if (!verify(data))
        throw new Error(
          'The saved document was not confirmed. Your edits remain here; reload to check.',
        );
      if (operation !== generation.current || controller.signal.aborted) return null;
      setState({ scope, data, loading: false, busy: false, error: null });
      return data;
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          busy: false,
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

  async function create(types: ScribeConsultationDocumentType[]) {
    const source = current?.data?.source;
    if (!source || source.state !== 'ready' || !source.hash || current?.loading || writing.current)
      return null;
    const identity = JSON.stringify([scope, source.hash, [...types].sort()]);
    if (pendingCreate.current?.identity !== identity)
      pendingCreate.current = { identity, operationId: crypto.randomUUID() };
    const operationId = pendingCreate.current.operationId;
    const parsed = ScribeConsultationDocumentsCreateSchema.safeParse({
      operationId,
      expectedSourceHash: source.hash,
      types,
    });
    if (!parsed.success) {
      setState((previous) => ({ ...previous, error: 'Choose at least one document type.' }));
      return null;
    }
    const result = await mutate(
      `/api/v1/scribe/encounters/${sessionId}/documents`,
      'POST',
      parsed.data,
      (data) =>
        data.packets.some(
          (packet) =>
            packet.body.operationId === operationId &&
            packet.body.sourceHash === source.hash &&
            packet.body.noteId === source.noteId &&
            packet.body.signedAt === source.signedAt &&
            JSON.stringify(packet.body.documents.map((doc) => doc.type).sort()) ===
              JSON.stringify([...types].sort()),
        ),
    );
    if (result && pendingCreate.current?.operationId === operationId) pendingCreate.current = null;
    return result;
  }

  async function save(
    packetId: string,
    revision: number,
    documentId: string,
    additions: string,
    reviewed: boolean,
  ) {
    const packet = current?.data?.packets.find((value) => value.id === packetId);
    const document = packet?.body.documents.find((value) => value.id === documentId);
    if (!packet?.sourceCurrent || !document || packet.revision !== revision) return null;
    const parsed = ScribeConsultationDocumentUpdateSchema.safeParse({
      revision,
      documentId,
      additions,
      reviewed,
    });
    if (!parsed.success) {
      setState((previous) => ({
        ...previous,
        error: parsed.error.issues[0]?.message ?? 'Check the document additions.',
      }));
      return null;
    }
    return mutate(`/api/v1/scribe/documents/${packetId}`, 'PATCH', parsed.data, (data) => {
      const saved = data.packets.find((value) => value.id === packetId);
      const next = saved?.body.documents.find((value) => value.id === documentId);
      if (!saved || !next) return false;
      const { documents: originalDocs, ...originalSource } = packet.body;
      const { documents: savedDocs, ...savedSource } = saved.body;
      return (
        saved.revision === revision + 1 &&
        JSON.stringify(savedSource) === JSON.stringify(originalSource) &&
        JSON.stringify(savedDocs.filter((doc) => doc.id !== documentId)) ===
          JSON.stringify(originalDocs.filter((doc) => doc.id !== documentId)) &&
        next.type === document.type &&
        JSON.stringify(next.sourceSections) === JSON.stringify(document.sourceSections) &&
        next.additions === parsed.data.additions &&
        next.status === (reviewed ? 'reviewed' : 'draft') &&
        (reviewed
          ? Boolean(next.reviewedAt && next.reviewedBy)
          : !next.reviewedAt && !next.reviewedBy)
      );
    });
  }

  async function download(
    packet: ScribeConsultationDocumentPacket,
    document: ScribeConsultationDocument,
  ) {
    const saved = current?.data?.packets.find((value) => value.id === packet.id);
    const doc = saved?.body.documents.find((value) => value.id === document.id);
    if (
      !saved?.sourceCurrent ||
      saved.revision !== packet.revision ||
      !doc ||
      doc.status !== 'reviewed' ||
      !doc.reviewedAt ||
      !doc.reviewedBy ||
      current?.loading ||
      writing.current
    )
      return false;
    writing.current = true;
    const operation = ++generation.current;
    const controller = new AbortController();
    pending.current?.abort();
    pending.current = controller;
    setState((previous) => ({ ...previous, busy: true, error: null }));
    try {
      const response = await request(
        `/api/v1/scribe/documents/${packet.id}/${document.id}/text?revision=${packet.revision}`,
        {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json();
        throw new Error(
          body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
            ? body.error
            : 'The draft could not be downloaded.',
        );
      }
      if (
        !response.headers.get('content-type')?.startsWith('text/plain') ||
        !response.headers.get('content-disposition')?.startsWith('attachment;')
      )
        throw new Error('The draft download could not be verified.');
      const blob = await response.blob();
      if (operation !== generation.current || controller.signal.aborted) return false;
      const url = URL.createObjectURL(blob);
      try {
        const link = globalThis.document.createElement('a');
        link.href = url;
        link.download = `scribe-${doc.type}-DRAFT.txt`;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
      setState((previous) => ({ ...previous, busy: false, error: null }));
      return true;
    } catch (error) {
      if (operation === generation.current && !controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          busy: false,
          error: error instanceof Error ? error.message : 'Download failed.',
        }));
      return false;
    } finally {
      if (operation === generation.current) writing.current = false;
      if (pending.current === controller) pending.current = null;
    }
  }

  return {
    state: current?.data ?? null,
    loading: enabled && (!current || current.loading),
    busy: current?.busy ?? false,
    error: current?.error ?? null,
    reload,
    create,
    save,
    download,
  };
}
