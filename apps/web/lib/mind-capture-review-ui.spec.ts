import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyNoteV1Schema, type NoteDraft } from '@cureocity/contracts';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
  verified: vi.fn(),
  reload: vi.fn(),
}));
// Execute real UI handlers with deterministic hooks, not a DOM/browser claim.
vi.mock('react', async (original) => ({
  ...(await original<typeof React>()),
  useState: <T>(initial: T) => {
    const index = h.stateIndex++;
    if (!(index in h.states)) h.states[index] = initial;
    return [
      h.states[index],
      (next: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof next === 'function' ? (next as (previous: T) => T)(h.states[index] as T) : next;
      },
    ];
  },
  useRef: <T>(initial: T) =>
    h.refs[h.refIndex++] ?? (h.refs[h.refIndex - 1] = { current: initial }),
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = h.effectIndex++,
      old = h.effects[index];
    if (!old || deps.some((dep, i) => dep !== old.deps[i]))
      h.queued.push(() => {
        old?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
import { MindCaptureReview } from '../components/app/MindCaptureReview';
type Props = {
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { checked: boolean } }) => void;
  role?: string;
};
function elements(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  return React.isValidElement<Props>(node) ? text(node.props.children) : String(node ?? '');
}
const stamp = '2026-10-08T00:00:00.000Z';
let draft: NoteDraft;
let disabled = false;
function status(overrides: Record<string, unknown> = {}) {
  return {
    draftId: draft.id,
    draftUpdatedAt: draft.updatedAt,
    reviewToken: 'token',
    reviewed: false,
    ...overrides,
  };
}
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const node = MindCaptureReview({
    sessionId: 'session',
    draft,
    disabled,
    onVerified: h.verified,
    onReload: h.reload,
  });
  h.queued.splice(0).forEach((run) => run());
  return node;
}
const settle = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};
function check() {
  const checkbox = elements(render()).find((node) => node.type === 'input')!;
  expect(checkbox.props.disabled).not.toBe(true);
  checkbox.props.onChange!({ target: { checked: true } });
}
function button() {
  return elements(render()).find(
    (node) => node.type === 'button' && text(node).includes('Record capture review'),
  )!;
}
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  disabled = false;
  h.reload.mockResolvedValue(undefined);
  draft = {
    id: 'draft',
    sessionId: 'session',
    status: 'COMPLETED',
    createdAt: stamp,
    updatedAt: stamp,
    transcript: 'Fictional captured words',
    speakerSegments: null,
    affectFeatures: null,
    riskSeverity: null,
    totalCostInr: '0',
    errorMessage: 'SCRIBE_CAPTURE_INCOMPLETE_V1:test',
    content: TherapyNoteV1Schema.parse({
      version: 'V1',
      modality: 'CBT',
      subjective: 'Corrected account',
      objective: 'Observation',
      assessment: 'Uncertain',
      plan: 'Agreed action',
      riskFlags: { severity: 'none' },
    }),
  };
  h.request.mockImplementation(async () => new Response(JSON.stringify(status())));
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.request);
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});
describe('Mind exact-draft capture review UI', () => {
  it('blocks confirmation until status loads and the clinician explicitly confirms', async () => {
    render();
    expect(button().props.disabled).toBe(true);
    await settle();
    expect(button().props.disabled).toBe(true);
    check();
    expect(button().props.disabled).toBe(false);
    button().props.onClick!();
    await settle();
    const post = h.request.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({
      reviewedDraftId: draft.id,
      reviewedNote: draft.content,
    });
    expect(h.reload).toHaveBeenCalledOnce();
    expect(h.verified).not.toHaveBeenCalledWith(stamp);
  });
  it('only restores an approval for the exact displayed revision', async () => {
    h.request.mockImplementation(
      async () => new Response(JSON.stringify(status({ reviewed: true }))),
    );
    render();
    await settle();
    expect(h.verified).toHaveBeenLastCalledWith(stamp);
    draft = { ...draft, updatedAt: '2026-10-08T00:01:00.000Z' };
    render();
    expect(h.verified).toHaveBeenLastCalledWith(null);
  });
  it('fails closed when the server revision is newer than the visible note', async () => {
    h.request.mockImplementation(
      async () => new Response(JSON.stringify(status({ draftUpdatedAt: 'newer', reviewed: true }))),
    );
    render();
    await settle();
    expect(text(render())).toContain('Reload the note');
    expect(button().props.disabled).toBe(true);
    expect(h.verified).not.toHaveBeenCalledWith(stamp);
  });
  it('does not permit review when source text is unreadable or a competing edit is active', async () => {
    render();
    await settle();
    check();
    disabled = true;
    expect(button().props.disabled).toBe(true);
    disabled = false;
    draft = { ...draft, transcript: null };
    expect(button().props.disabled).toBe(true);
  });
  it('does not apply a late status response after a newer draft is displayed', async () => {
    let resolve!: (response: Response) => void;
    const old = status({ reviewed: true });
    h.request.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    render();
    draft = { ...draft, updatedAt: '2026-10-08T00:02:00.000Z' };
    render();
    resolve(new Response(JSON.stringify(old)));
    await settle();
    expect(h.verified).not.toHaveBeenCalledWith(stamp);
  });
  it('does not reload a replacement draft from an old in-flight confirmation', async () => {
    render();
    await settle();
    check();
    let resolve!: (response: Response) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    button().props.onClick!();
    draft = { ...draft, updatedAt: '2026-10-08T00:03:00.000Z' };
    render();
    resolve(new Response('{}'));
    await settle();
    expect(h.reload).not.toHaveBeenCalled();
  });
});
