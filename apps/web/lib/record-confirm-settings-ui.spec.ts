import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  si: 0,
  ri: 0,
  ei: 0,
  fetch: vi.fn(),
  push: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const i = h.si++;
    if (!(i in h.states))
      h.states[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[i],
      (value: T | ((previous: T) => T)) => {
        h.states[i] =
          typeof value === 'function' ? (value as (previous: T) => T)(h.states[i] as T) : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const i = h.ri++;
    return h.refs[i] ?? (h.refs[i] = { current });
  },
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const i = h.ei++;
    const previous = h.effects[i];
    if (!previous || deps.some((dep, index) => dep !== previous.deps[index]))
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[i] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/ui/Field', () => ({
  Select: 'select',
  Label: 'label',
  CheckboxRow: 'checkbox',
  FieldError: 'error',
}));
vi.mock('../components/app/PreparePanel', () => ({ PreparePanel: 'prepare-panel' }));
vi.mock('../components/app/SessionPreparationPanel', () => ({
  SessionPreparationPanel: 'session-preparation',
}));
vi.mock('../components/app/MindSessionPreflight', () => ({ MindSessionPreflight: 'preflight' }));
vi.mock('@/lib/audio/use-session-recorder', () => ({ isDisplayCaptureSupported: () => false }));
import { RecordConfirmStrip } from '../components/app/RecordConfirmStrip';
type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  id?: string;
  value?: string;
  disabled?: boolean;
  onReadyChange?: (value: boolean) => void;
  message?: string;
};
const all = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...all(child.props.children)] : [],
  );
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
let expected: string | null;
let saved: Record<string, unknown>;
const defaults = {
  kind: 'TREATMENT',
  modality: 'CBT',
  modalitySource: 'client',
  language: 'en',
  spokenLanguages: ['en'],
  consentsAlreadyGranted: [],
  consentsNeeded: [],
  sessionsCompleted: 1,
  lastInstrumentAdministrations: {},
};
function render() {
  h.si = h.ri = h.ei = 0;
  const result = RecordConfirmStrip({
    clientId: 'client-a',
    clientName: 'Fictional Nila',
    expectedSessionId: expected,
    sessionPreparationEnabled: true,
    onCancel: () => {},
    onReady: () => {},
  });
  h.queued.splice(0).forEach((run) => run());
  return result;
}
const field = (id: string) => all(render()).find((node) => node.props.id === id);
const button = (label: string) =>
  all(render()).find((node) => node.type === 'button' && text(node.props.children) === label);
function click(label: string) {
  const found = button(label);
  expect(found, label).toBeDefined();
  expect(found!.props.disabled).not.toBe(true);
  found!.props.onClick!();
}
async function load() {
  render();
  await vi.waitFor(() => expect(button('Change details')).toBeDefined());
  click('Change details');
}
beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  expected = null;
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.fetch);
  vi.stubGlobal('window', { confirm: () => true });
  saved = {
    id: 'visit-a',
    clientId: 'client-a',
    kind: 'TREATMENT',
    modality: 'ACT',
    language: 'ml',
    status: 'SCHEDULED',
    scheduledAt: '2026-09-13T09:00:00.000Z',
    updatedAt: '2026-09-13T08:00:00.000Z',
    mindDocumentationMode: null,
  };
  h.fetch.mockImplementation(async (url: string) =>
    url.endsWith('?guides=1')
      ? Response.json({ guides: [] })
      : url.endsWith('/session-defaults')
        ? Response.json({ defaults })
        : Response.json(saved),
  );
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});
describe('preparation preserves authoritative visit settings (hook harness)', () => {
  it('loads an exact booking read-only before presenting its saved language/style', async () => {
    expected = 'visit-a';
    await load();
    expect(field('rcs-language')?.props).toMatchObject({ value: 'ml', disabled: true });
    expect(field('rcs-modality')?.props).toMatchObject({ value: 'ACT', disabled: true });
    expect(text(render())).toContain('Uses the saved note language for this visit');
    expect(h.fetch.mock.calls.some(([url]) => url === '/api/v1/sessions/visit-a')).toBe(true);
    expect(h.fetch.mock.calls.some(([url]) => url === '/api/v1/sessions')).toBe(false);
  });
  it('locks the acknowledged prepared walk-in settings, never promises a change Start would discard', async () => {
    saved = { ...saved, modality: 'CBT', language: 'en' };
    await load();
    expect(field('rcs-language')?.props.disabled).toBe(false);
    click('Select a visit to prepare (optional)');
    await vi.waitFor(() => expect(field('rcs-language')?.props.disabled).toBe(true));
    expect(field('rcs-language')?.props.value).toBe('en');
    expect(field('rcs-modality')?.props).toMatchObject({ value: 'CBT', disabled: true });
    expect(h.fetch.mock.calls.filter(([url]) => url === '/api/v1/sessions')).toHaveLength(1);
    expect(
      h.fetch.mock.calls.some(([url]) => /\/consent|\/start|\/live-token/.test(String(url))),
    ).toBe(false);
    expect(h.push).not.toHaveBeenCalled();
  });
  it('does not invent a stored language for a compatible older server response', async () => {
    expected = 'visit-a';
    delete saved.language;
    await load();
    expect(field('rcs-language')?.props).toMatchObject({ value: '', disabled: true });
    expect(text(render())).toContain('Saved visit language');
  });
  it('blocks start on wrong-visit settings read without creating a replacement', async () => {
    expected = 'visit-b';
    render();
    await vi.waitFor(() =>
      expect(
        all(render()).some((node) =>
          node.props.message?.includes('saved visit settings could not be confirmed'),
        ),
      ).toBe(true),
    );
    expect(button('Start recording')).toBeUndefined();
    expect(h.fetch.mock.calls.some(([url]) => url === '/api/v1/sessions')).toBe(false);
  });
  it('requires review when start resolves a different saved style/language before any capture or consent', async () => {
    await load();
    field('rcs-today-confirmation')!.props.onChange!(true as never);
    all(render()).find((node) => node.type === 'preflight')!.props.onReadyChange!(true);
    click('Start recording');
    await vi.waitFor(() => expect(field('rcs-language')?.props.value).toBe('ml'));
    expect(field('rcs-modality')?.props).toMatchObject({ value: 'ACT', disabled: true });
    expect(
      h.fetch.mock.calls.some(([url]) => /\/consent|\/start|\/live-token/.test(String(url))),
    ).toBe(false);
    expect(h.push).not.toHaveBeenCalled();
    click('Start recording');
    await vi.waitFor(() =>
      expect(h.push).toHaveBeenCalledWith('/app/sessions/visit-a/live?flash=1'),
    );
    const selectionCalls = h.fetch.mock.calls.filter(([url]) => url === '/api/v1/sessions');
    expect(JSON.parse(selectionCalls[1][1].body)).toMatchObject({
      expectedSessionId: 'visit-a',
      modality: 'ACT',
      language: 'ml',
    });
  });
  it('does not visually replace an unset saved therapy style with the first menu option', async () => {
    expected = 'visit-a';
    saved.modality = null;
    await load();
    expect(field('rcs-modality')?.props).toMatchObject({ value: '', disabled: true });
    expect(text(field('rcs-modality')?.props.children)).toContain('Not selected');
  });
});
