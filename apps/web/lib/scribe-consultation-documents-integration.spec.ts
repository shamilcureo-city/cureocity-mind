import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScribeConsultationDocumentsResponse } from './scribe-consultation-documents';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  hook: vi.fn(),
  reload: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  download: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T | ((old: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (old: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
}));
vi.mock('@/lib/use-scribe-consultation-documents', () => ({
  useScribeConsultationDocuments: h.hook,
}));
vi.mock('../components/app/ScribeReportsPanel', () => ({ ScribeReportsPanel: () => null }));
vi.mock('../components/app/ScribePatientInstructions', () => ({
  ScribePatientInstructions: () => null,
}));
vi.mock('../components/app/ScribePendingWorkPanel', () => ({ ScribePendingWorkPanel: () => null }));
vi.mock('next/navigation', () => ({ notFound: h.notFound }));

import { ScribeEncounterTools } from '../components/app/ScribeEncounterTools';
import { ScribeConsultationDocumentsWorkspace } from '../components/app/ScribeConsultationDocumentsWorkspace';
import { ScribeConsultationDocumentsPanel } from '../components/app/ScribeConsultationDocumentsPanel';
import { ScribeTransportProvider } from '../components/app/ScribeTransport';
import { ScribeDocumentsPreview } from '../app/dev/scribe-documents/ScribeDocumentsPreview';
import PreviewPage, { metadata } from '../app/dev/scribe-documents/page';

type ElementProps = {
  children?: ReactNode;
  id?: string;
  hidden?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  clientId?: string;
  sessionId?: string;
  signed?: boolean;
};
function elements(node: ReactNode): ReactElement<ElementProps>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<ElementProps>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<ElementProps>(child) ? text(child.props.children) : String(child),
    )
    .join('');
}
let props: Parameters<typeof ScribeEncounterTools>[0];
function tools() {
  h.stateIndex = 0;
  return ScribeEncounterTools(props);
}
function click(label: string) {
  const button = elements(tools()).find(
    (element) => element.type === 'button' && text(element.props.children) === label,
  );
  expect(button).toBeDefined();
  expect(button!.props.disabled).toBeFalsy();
  button!.props.onClick!();
}
function workspace() {
  return elements(tools()).find((element) => element.type === ScribeConsultationDocumentsWorkspace);
}
function wrapper() {
  return elements(tools()).find(
    (element) => element.props.id === `scribe-${props.sessionId}-documents`,
  );
}
function previewTransport() {
  h.states = [];
  h.stateIndex = 0;
  const result = ScribeDocumentsPreview() as ReactElement<{ fetcher: typeof fetch }>;
  expect(result.type).toBe(ScribeTransportProvider);
  return result.props.fetcher;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.stateIndex = 0;
  vi.stubGlobal('React', React);
  props = { clientId: 'client-1', sessionId: 'session-1', signed: false };
  h.hook.mockReturnValue({
    state: { source: { state: 'unsigned', hash: null, noteId: null, signedAt: null }, packets: [] },
    loading: false,
    busy: false,
    error: null,
    reload: h.reload,
    create: h.create,
    save: h.save,
    download: h.download,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('consultation tools integration', () => {
  it('lazily mounts documents and preserves the same workspace when closed or another tool opens', () => {
    expect(workspace()).toBeUndefined();
    click('Consultation documents');
    const opened = workspace()!;
    expect(opened).toBeDefined();
    expect(wrapper()?.props.hidden).toBe(false);
    click('Reports');
    expect(wrapper()?.props.hidden).toBe(true);
    expect(workspace()?.type).toBe(opened.type);
    expect(workspace()?.key).toBe(opened.key);
    click('Consultation documents');
    expect(wrapper()?.props.hidden).toBe(false);
    click('Consultation documents');
    expect(wrapper()?.props.hidden).toBe(true);
    expect(workspace()?.key).toBe(opened.key);
  });

  it('changes the workspace key for either patient or encounter, preventing local draft carry-over', () => {
    click('Consultation documents');
    const firstKey = workspace()!.key;
    props = { ...props, clientId: 'client-2' };
    const nextClientKey = workspace()!.key;
    expect(nextClientKey).not.toBe(firstKey);
    expect(workspace()!.props).toMatchObject({ clientId: 'client-2', sessionId: 'session-1' });
    props = { ...props, sessionId: 'session-2' };
    expect(workspace()!.key).not.toBe(nextClientKey);
    expect(workspace()!.props).toMatchObject({ clientId: 'client-2', sessionId: 'session-2' });
  });

  it.each([false, true])('does not use local signed=%s as document source authority', (signed) => {
    props = { ...props, signed };
    click('Consultation documents');
    expect(workspace()).toBeDefined();
    expect(workspace()!.props).toMatchObject({ clientId: 'client-1', sessionId: 'session-1' });
    expect(workspace()!.props.signed).toBeUndefined();
  });

  it('passes the server-derived state and guarded actions directly to the document panel', () => {
    const result = ScribeConsultationDocumentsWorkspace({
      clientId: 'client-1',
      sessionId: 'session-1',
    }) as ReactElement<Parameters<typeof ScribeConsultationDocumentsPanel>[0]>;
    expect(h.hook).toHaveBeenCalledWith({
      clientId: 'client-1',
      sessionId: 'session-1',
      enabled: true,
    });
    expect(result.type).toBe(ScribeConsultationDocumentsPanel);
    expect(result.props.state).toBe(h.hook.mock.results[0].value.state);
    expect(result.props.state?.source.state).toBe('unsigned');
    expect(result.props.onCreate).toBe(h.create);
    expect(result.props.onSave).toBe(h.save);
    expect(result.props.onDownload).toBe(h.download);
    result.props.onReload();
    expect(h.reload).toHaveBeenCalledOnce();
  });
});

describe('fictional documents preview boundary', () => {
  it.each([
    ['production', 'true'],
    ['test', 'true'],
    ['development', 'false'],
    ['development', undefined],
  ])('is unavailable for NODE_ENV=%s and preview flag=%s', (environment, flag) => {
    vi.stubEnv('NODE_ENV', environment);
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', flag);
    expect(() => PreviewPage()).toThrow('NOT_FOUND');
    expect(h.notFound).toHaveBeenCalledOnce();
  });

  it('renders only with both development mode and explicit preview flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('SCRIBE_WORKSPACE_PREVIEW', 'true');
    expect(PreviewPage().type).toBe(ScribeDocumentsPreview);
    expect(h.notFound).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('uses only its memory transport for create/review/download and blocks unknown clinical URLs', async () => {
    const network = vi.fn(() => {
      throw new Error('Real network must not be called by preview');
    });
    const localStorage = { getItem: vi.fn(), setItem: vi.fn() };
    const sessionStorage = { getItem: vi.fn(), setItem: vi.fn() };
    vi.stubGlobal('fetch', network);
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    const fetcher = previewTransport();
    const url = '/api/v1/scribe/encounters/fictional-visit/documents';
    const initial = (await (await fetcher(url)).json()) as ScribeConsultationDocumentsResponse;
    expect(initial.packets).toEqual([]);
    const created = (await (
      await fetcher(url, {
        method: 'POST',
        body: JSON.stringify({
          operationId: '76e2c960-52eb-4996-8c7e-de63872a3170',
          expectedSourceHash: initial.source.hash,
          types: ['medical_certificate'],
        }),
      })
    ).json()) as ScribeConsultationDocumentsResponse;
    const packet = created.packets[0];
    expect(packet.clientId).toBe('fictional-patient');
    expect(packet.body.documents[0].sourceSections).toEqual([]);
    const reviewed = (await (
      await fetcher(`/api/v1/scribe/documents/${packet.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          revision: packet.revision,
          documentId: 'medical_certificate',
          additions: 'Fictional draft particulars only.',
          reviewed: true,
        }),
      })
    ).json()) as ScribeConsultationDocumentsResponse;
    const download = await fetcher(
      `/api/v1/scribe/documents/${packet.id}/medical_certificate/text?revision=${reviewed.packets[0].revision}`,
    );
    expect(download.headers.get('content-type')).toContain('text/plain');
    expect(await download.text()).toContain('NOT VALID FOR ISSUE');
    const blocked = await fetcher('/api/v1/scribe/encounters/a-real-encounter/documents');
    expect(blocked.status).toBe(404);
    expect(network).not.toHaveBeenCalled();
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    }
    // A fresh mount owns a new fixture; preview edits are not restored or persisted.
    const fresh = (await (
      await previewTransport()(url)
    ).json()) as ScribeConsultationDocumentsResponse;
    expect(fresh.packets).toEqual([]);
  });
});
