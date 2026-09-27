import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScribePendingWork } from './scribe-preparation-contracts';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as boolean[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T) => {
        h.states[index] = value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
  useCallback: <T>(callback: T) => callback,
  // These tests keep the same patient/transport; run the mount effect once.
  useEffect: (effect: () => void) => {
    const index = h.effectIndex++;
    if (!h.effects[index]) {
      h.effects[index] = true;
      h.queued.push(effect);
    }
  },
}));
vi.mock('../components/app/ScribeTransport', () => ({ useScribeFetch: () => h.request }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Field', () => ({
  Input: 'input',
  Label: 'label',
  Select: 'select',
  Textarea: 'textarea',
}));
import { ScribePendingWorkPanel } from '../components/app/ScribePendingWorkPanel';

type Props = {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
};
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
}
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  const tree = ScribePendingWorkPanel({
    clientId: 'fictional-patient',
    patients: [{ id: 'fictional-patient', name: 'Private fictional patient' }],
  });
  h.queued.splice(0).forEach((effect) => effect());
  return tree;
}
function html() {
  return renderToStaticMarkup(render());
}
function click(label: string) {
  const button = elements(render()).find((node) => node.type === 'button' && text(node) === label);
  expect(button, `Missing button ${label}`).toBeDefined();
  expect(button?.props.disabled).toBeFalsy();
  button!.props.onClick!();
}
function submitCreate() {
  elements(render()).find((node) => node.type === 'form')!.props.onSubmit!({
    preventDefault: vi.fn(),
  });
}
const inbox: ScribePendingWork = {
  tasks: [
    {
      id: 'fictional-task',
      revision: 1,
      clientId: 'fictional-patient',
      sessionId: null,
      createdAt: '2026-09-27T00:00:00Z',
      updatedAt: '2026-09-27T00:00:00Z',
      body: {
        title: 'Private fictional result',
        details: 'Private fictional details',
        category: 'results',
        dueDate: '2026-09-28',
        assignee: 'Doctor (you)',
        status: 'open',
        completionNote: '',
      },
    },
  ],
  unsigned: [
    {
      sessionId: 'fictional-session',
      clientId: 'fictional-patient',
      patientName: 'Private fictional patient',
      encounterAt: '2026-09-27T00:00:00Z',
    },
  ],
  unsignedMayHaveMore: false,
  tasksMayHaveMore: false,
};
const inactive = () => Response.json({ code: 'PRACTITIONER_INACTIVE' }, { status: 403 });
async function loadInbox() {
  h.request.mockResolvedValueOnce(Response.json(inbox));
  render();
  await vi.waitFor(() => expect(html()).toContain('Private fictional result'));
}
function expectHiddenAccessState() {
  const markup = html();
  expect(markup).not.toContain('Private fictional');
  expect(markup).not.toContain('Create task');
  expect(markup).not.toContain('Mark done');
  expect(markup).not.toContain('Refresh');
  expect(markup).not.toContain('<form');
  return markup;
}

beforeEach(() => {
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.queued = [];
  h.stateIndex = h.refIndex = h.effectIndex = 0;
  vi.resetAllMocks();
  vi.stubGlobal('React', React);
});
afterEach(() => vi.unstubAllGlobals());

describe('pending-work access-denial UI', () => {
  it.each([
    [401, {}, '/login', 'Sign in again'],
    [403, { code: 'PRACTITIONER_INACTIVE' }, '/account-status', 'account is not active'],
    [
      403,
      { error: 'Practitioner account is not active' },
      '/account-status',
      'account is not active',
    ],
    [
      403,
      { error: 'private server details' },
      'mailto:shamil@cureo.city?subject=Scribe%20account%20access',
      'does not have permission',
    ],
  ])(
    'shows a recovery action without patient actions for %s %j',
    async (status, body, href, message) => {
      h.request.mockResolvedValueOnce(Response.json(body, { status: status as number }));
      render();
      await vi.waitFor(() => expect(html()).toContain(message));
      const markup = expectHiddenAccessState();
      expect(markup).toContain(`href="${href}"`);
      expect(markup).not.toContain('private server details');
      expect(h.request).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps temporary failures retryable and restores the inbox after retry', async () => {
    h.request.mockResolvedValueOnce(new Response('', { status: 503 }));
    render();
    await vi.waitFor(() => expect(html()).toContain('Could not load pending work'));
    expect(html()).toContain('Refresh');
    expect(html()).not.toContain('Create task');
    h.request.mockResolvedValueOnce(Response.json(inbox));
    click('Refresh');
    await vi.waitFor(() => expect(html()).toContain('Private fictional result'));
    expect(html()).toContain('Create task');
  });

  it('clears previously loaded patient information when refresh loses access', async () => {
    await loadInbox();
    h.request.mockResolvedValueOnce(inactive());
    click('Refresh');
    await vi.waitFor(() => expect(html()).toContain('account is not active'));
    expectHiddenAccessState();
  });

  it.each(['create', 'update'])(
    'blocks the UI after %s denial without another refresh',
    async (operation) => {
      await loadInbox();
      h.request.mockResolvedValueOnce(inactive());
      if (operation === 'create') submitCreate();
      else click('Mark done');
      await vi.waitFor(() => expect(html()).toContain('account is not active'));
      expectHiddenAccessState();
      expect(h.request).toHaveBeenCalledTimes(2);
      expect(h.request.mock.calls[1]?.[1]?.method).toBe(operation === 'create' ? 'POST' : 'PATCH');
    },
  );

  it('does not restore patient data when an older refresh succeeds after a mutation loses access', async () => {
    await loadInbox();
    let finishRefresh!: (response: Response) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    click('Refresh');
    h.request.mockResolvedValueOnce(inactive());
    click('Mark done');
    await vi.waitFor(() => expect(html()).toContain('account is not active'));
    finishRefresh(Response.json(inbox));
    await vi.waitFor(() => expect(h.states[0]).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expectHiddenAccessState();
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it('does not swallow an access denial while refreshing a conflicting task update', async () => {
    await loadInbox();
    h.request.mockResolvedValueOnce(new Response('', { status: 409 }));
    h.request.mockResolvedValueOnce(inactive());
    click('Mark done');
    await vi.waitFor(() => expect(html()).toContain('account is not active'));
    expectHiddenAccessState();
    expect(h.request).toHaveBeenCalledTimes(3);
  });

  it('does not replace an access denial with a late transient refresh error', async () => {
    await loadInbox();
    let rejectRefresh!: (reason: Error) => void;
    h.request.mockImplementationOnce(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectRefresh = reject;
        }),
    );
    click('Refresh');
    h.request.mockResolvedValueOnce(inactive());
    click('Mark done');
    await vi.waitFor(() => expect(html()).toContain('account is not active'));
    rejectRefresh(new Error('private network details'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(expectHiddenAccessState()).toContain('account is not active');
  });

  it('sanitizes a network error and allows retry', async () => {
    h.request.mockRejectedValueOnce(new Error('private request headers'));
    render();
    await vi.waitFor(() => expect(html()).toContain('Could not load pending work'));
    expect(html()).not.toContain('private request headers');
    expect(html()).toContain('Refresh');
  });
});
