import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntakeNoteV1Schema, TherapyNoteV1Schema, type NoteDraft } from '@cureocity/contracts';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  sign: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof React>()),
  useCallback: <T>(fn: T) => fn,
  useEffect: () => {},
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (next: T | ((old: T) => T)) => {
        harness.states[index] =
          typeof next === 'function' ? (next as (old: T) => T)(harness.states[index] as T) : next;
      },
    ];
  },
  useRef: <T>(initial: T) => {
    const index = harness.refIndex++;
    return (harness.refs[index] ??= { current: initial });
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('./sign-note', () => ({ postSignNote: harness.sign }));

import { NotesTab } from '../components/app/NotesTab';
import { TemplatePicker } from '../components/app/TemplatePicker';

type Props = Record<string, unknown> & {
  children?: React.ReactNode;
  leftControls?: React.ReactNode;
};
type Element = React.ReactElement<Props>;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children), ...elements(element.props.leftControls)];
}
function find(node: React.ReactNode, name: string) {
  const result = elements(node).find(
    (element) =>
      element.type === name || (typeof element.type === 'function' && element.type.name === name),
  );
  expect(result, `Missing component ${name}`).toBeDefined();
  return result!;
}
function invoke(element: Element, key: string, ...args: unknown[]) {
  return (element.props[key] as (...args: unknown[]) => unknown)(...args);
}
function component(element: Element) {
  return (element.type as (props: Props) => React.ReactNode)(element.props);
}
const timestamp = '2026-09-14T12:00:00.000Z';
function draft(kind: 'INTAKE' | 'TREATMENT'): NoteDraft {
  const content =
    kind === 'INTAKE'
      ? IntakeNoteV1Schema.parse({
          version: 'V1',
          presentingConcerns: 'Synthetic concern',
          historyOfPresentingIllness: 'Synthetic history',
          pastPsychiatricHistory: '',
          familyHistory: '',
          socialHistory: '',
          mentalStatusExam: 'Synthetic observations',
          workingHypothesis: 'Synthetic hypothesis',
          immediatePlan: 'Synthetic plan',
          riskFlags: { severity: 'none' },
        })
      : TherapyNoteV1Schema.parse({
          version: 'V1',
          modality: 'SUPPORTIVE',
          subjective: 'Synthetic account',
          objective: 'Synthetic observations',
          assessment: 'Synthetic assessment',
          plan: 'Synthetic plan',
          riskFlags: { severity: 'none' },
        });
  return {
    id: 'draft-test',
    sessionId: 'session-test',
    status: 'COMPLETED',
    content,
    transcript: null,
    speakerSegments: null,
    affectFeatures: null,
    riskSeverity: null,
    totalCostInr: '0',
    errorMessage: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
function render(kind: 'INTAKE' | 'TREATMENT') {
  harness.stateIndex = 0;
  harness.refIndex = 0;
  return NotesTab({
    sessionId: 'session-test',
    sessionStatus: 'COMPLETED',
    sessionKind: kind,
    initialDraft: draft(kind),
    initialNote: null,
    noteLocked: false,
    clientId: 'client-test',
    clientHasContactPhone: false,
    clientHasContactEmail: false,
    llmBackend: 'mock',
    clientName: 'Fictional client',
    noteLanguage: 'en',
    clientPreferredLanguage: 'en',
    noteTemplateId: null,
    signerName: 'Fictional clinician',
    canShare: false,
    focusedReview: true,
  });
}
function ready(kind: 'INTAKE' | 'TREATMENT') {
  invoke(find(render(kind), 'NoteRecoveryNotice'), 'onStatusChange', 'none');
  return render(kind);
}

beforeEach(() => {
  harness.states = [];
  harness.refs = [];
  harness.stateIndex = 0;
  harness.refIndex = 0;
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['INTAKE', 'TREATMENT'] as const)('NotesTab %s competing action boundary', (kind) => {
  it('gates callbacks from the previous render immediately when rewrite claims busy', async () => {
    const tree = ready(kind);
    const panel = find(tree, 'ModifyPanel');
    const actions = find(tree, 'NoteActions');
    invoke(panel, 'onBusyChange', true);
    await invoke(actions, 'onRegenerate');
    await invoke(find(tree, 'TemplatePicker'), 'onApply');
    await invoke(find(tree, 'LanguagePicker'), 'onChange', 'ml');
    await invoke(actions, 'onSign');
    invoke(actions, 'onEdit');
    invoke(find(tree, 'NoteRecoveryNotice'), 'onResume');
    expect(fetch).not.toHaveBeenCalled();
    expect(harness.sign).not.toHaveBeenCalled();
    const busy = render(kind);
    expect(find(busy, 'NoteActions')).toBeDefined();
    expect(find(busy, 'TemplatePicker').props.disabled).toBe(true);
    expect(find(busy, 'LanguagePicker').props.disabled).toBe(true);
    for (const button of elements(component(find(busy, 'NoteActions'))).filter(
      (element) => element.type === 'button',
    )) {
      expect(button.props.disabled).toBe(true);
    }
    expect(find(busy, 'SignAndSendBar').props.blocked).toBe(true);
    invoke(panel, 'onBusyChange', false);
    const released = render(kind);
    expect(find(released, 'TemplatePicker').props.disabled).toBe(false);
    expect(find(released, 'LanguagePicker').props.disabled).toBe(false);
    invoke(find(released, 'NoteActions'), 'onEdit');
    expect(find(render(kind), kind === 'INTAKE' ? 'IntakeNoteEditor' : 'NoteEditor')).toBeDefined();
  });

  it('blocks the rewrite panel while regeneration is in flight', async () => {
    const tree = ready(kind);
    let resolveGeneration!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveGeneration = resolve;
        }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(draft(kind)), { status: 200 }),
    );
    const request = invoke(find(tree, 'NoteActions'), 'onRegenerate');
    expect(find(render(kind), 'ModifyPanel').props.busy).toBe(true);
    resolveGeneration(new Response('{}', { status: 200 }));
    await request;
    expect(find(render(kind), 'ModifyPanel').props.busy).toBe(false);
  });
});

describe('TemplatePicker already-open menu boundary', () => {
  function renderPicker(disabled = false) {
    harness.stateIndex = 0;
    harness.refIndex = 0;
    return TemplatePicker({
      sessionId: 'session-test',
      currentTemplateId: null,
      disabled,
      onApply: vi.fn(),
    });
  }
  it('hides an open menu and prevents a retained row callback from writing while disabled', async () => {
    const closed = renderPicker();
    invoke(find(closed, 'button'), 'onClick');
    const open = renderPicker();
    const row = find(open, 'Row');
    const disabled = renderPicker(true);
    expect(
      elements(disabled).some(
        (element) => typeof element.type === 'function' && element.type.name === 'Row',
      ),
    ).toBe(false);
    expect(find(disabled, 'button').props.disabled).toBe(true);
    await invoke(row, 'onClick');
    expect(fetch).not.toHaveBeenCalled();
  });
});
