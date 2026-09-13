import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { MindCareRecordBodySchema } from '@cureocity/contracts';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  fetch: vi.fn(),
  guard: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'care-test',
  // Deliberately do not run effects: render-time identity checks must hold before cleanup/reset.
  useEffect: () => undefined,
  useState: <T>(initial: T | (() => T)) => {
    const index = h.stateIndex++;
    if (!(index in h.states))
      h.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      h.states[index],
      (value: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (previous: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current });
  },
}));
vi.mock('@/lib/use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: h.guard }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('next/link', () => ({ default: 'a' }));
import { MindCareRecordPanel, EMPTY_MIND_CARE_RECORD } from '../components/app/MindCareRecordPanel';
import { MindCareContinuitySummary } from '../components/app/MindCareContinuitySummary';

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  id?: string;
  value?: string;
  disabled?: boolean;
  readOnly?: boolean;
};
const sessionContext = { sessionId: 'visit-1', scheduledAt: '2026-09-10T09:00:00.000Z' };
function render(clientId = 'client-1', context = sessionContext) {
  h.stateIndex = h.refIndex = 0;
  return MindCareRecordPanel({ clientId, sessionContext: context });
}
function renderSummary(clientId: string) {
  h.stateIndex = h.refIndex = 0;
  return MindCareContinuitySummary({ clientId });
}
function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
}
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
function button(label: string) {
  return elements(render()).find(
    (el) => el.type === 'button' && text(el.props.children).includes(label),
  )!;
}
function click(label: string) {
  const action = button(label);
  expect(action).toBeDefined();
  expect(action.props.disabled).not.toBe(true);
  action.props.onClick!();
}
function field(suffix: string) {
  return elements(render()).find((el) => el.props.id === `care-test-${suffix}`)!;
}
function change(suffix: string, value: string) {
  const input = field(suffix);
  expect(input.props.disabled || input.props.readOnly).not.toBe(true);
  input.props.onChange!({ target: { value } });
}
async function edit() {
  click('Work done & client response');
  await vi.waitFor(() => expect(button('Record or correct')).toBeDefined());
  click('Record or correct');
}
const postCalls = () => h.fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
function savedResponse(init: RequestInit) {
  const input = JSON.parse(String(init.body));
  return Response.json({
    record: {
      id: 'record-1',
      clientId: 'client-1',
      version: input.expectedVersion + 1,
      operationId: input.operationId,
      createdAt: '2026-09-13T10:00:00.000Z',
      body: MindCareRecordBodySchema.parse(input.body),
    },
    latestVersion: input.expectedVersion + 1,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.states = [];
  h.refs = [];
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.fetch);
  h.fetch.mockImplementation(async (_url, init) =>
    init?.method === 'POST'
      ? savedResponse(init)
      : Response.json({ record: null, latestVersion: 0 }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('explicit session-work UI wiring', () => {
  it('hides the old client summary immediately, even before any effect reset runs', () => {
    renderSummary('client-1');
    h.states[0] = {
      id: 'care-1',
      clientId: 'client-1',
      version: 1,
      operationId: '42ed94db-c64f-43ea-9df7-4d594305c1f5',
      createdAt: '2026-09-13T10:00:00.000Z',
      body: {
        ...EMPTY_MIND_CARE_RECORD,
        sessionWork: {
          ...sessionContext,
          disposition: 'USED',
          workDone: 'Old client fictional work',
          clientResponse: '',
        },
      },
    };
    h.states[1] = 'ready';
    expect(text(renderSummary('client-1'))).toContain('Old client fictional work');
    const switched = text(renderSummary('client-2'));
    expect(switched).not.toContain('Old client fictional work');
    expect(switched).toContain('Checking clinician-recorded session work');
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(['client', 'session', 'date'])(
    'hides but preserves an unsaved draft on a %s context switch without rebinding its write target',
    async (changeKind) => {
      await edit();
      change('work-status', 'ADAPTED');
      change('work-done', 'Held fictional wording');
      const switched = render(changeKind === 'client' ? 'client-2' : 'client-1', {
        ...sessionContext,
        ...(changeKind === 'session' ? { sessionId: 'visit-2' } : {}),
        ...(changeKind === 'date' ? { scheduledAt: '2026-09-11T09:00:00.000Z' } : {}),
      });
      expect(text(switched)).not.toContain('Held fictional wording');
      expect(elements(switched).some((el) => el.type === 'textarea')).toBe(false);
      expect(text(switched)).toContain('draft remains held');
      expect(text(switched)).not.toContain('Switch care-record view');
      expect(postCalls()).toHaveLength(0);
      // Returning props to the original context restores the same in-memory work.
      expect(field('work-done').props.value).toBe('Held fictional wording');
      click('Confirm work & save');
      await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(postCalls()[0][0]).toBe('/api/v1/clients/client-1/care-record');
      expect(JSON.parse(postCalls()[0][1].body).body.sessionWork.sessionId).toBe('visit-1');
    },
  );
  it('requires an explicit clean-context switch and drops old displayed state before loading the new client', async () => {
    await edit();
    change('work-status', 'USED');
    change('work-done', 'Previously saved fictional work');
    click('Confirm work & save');
    await vi.waitFor(() => expect(text(render())).toContain('Version 1 saved'));
    const next = { ...sessionContext, sessionId: 'visit-2' };
    const switched = render('client-2', next);
    expect(text(switched)).not.toContain('Previously saved fictional work');
    const switchButton = elements(switched).find(
      (el) => el.type === 'button' && text(el.props.children) === 'Switch care-record view',
    )!;
    switchButton.props.onClick!();
    const newView = render('client-2', next);
    expect(text(newView)).not.toContain('Previously saved fictional work');
    const open = elements(newView).find(
      (el) =>
        el.type === 'button' && text(el.props.children).includes('Work done & client response'),
    )!;
    open.props.onClick!();
    await vi.waitFor(() =>
      expect(h.fetch.mock.calls.at(-1)?.[0]).toBe('/api/v1/clients/client-2/care-record'),
    );
  });
  it('keeps an uncertain prior-client packet hidden and intact until returning to that view', async () => {
    await edit();
    change('work-status', 'USED');
    change('work-done', 'Unconfirmed fictional work');
    h.fetch.mockRejectedValueOnce(new TypeError('Lost acknowledgement'));
    click('Confirm work & save');
    await vi.waitFor(() => expect(button('Retry the same save')).toBeDefined());
    const switched = render('client-2', { ...sessionContext, sessionId: 'visit-2' });
    expect(text(switched)).not.toContain('Unconfirmed fictional work');
    expect(text(switched)).not.toContain('Switch care-record view');
    click('Retry the same save');
    await vi.waitFor(() => expect(postCalls()).toHaveLength(2));
    expect(postCalls()[1][1].body).toBe(postCalls()[0][1].body);
    expect(postCalls()[1][0]).toBe('/api/v1/clients/client-1/care-record');
  });
  it('never saves merely by opening the care record, reading it or entering an unconfirmed draft', async () => {
    render();
    expect(h.fetch).not.toHaveBeenCalled();
    await edit();
    expect(field('work-status').props.value).toBe('');
    change('work-done', 'Fictional work actually done');
    expect(postCalls()).toHaveLength(0);
    expect(text(render())).not.toContain('Your counselling agreement');
    click('Confirm work & save');
    expect(postCalls()).toHaveLength(0);
    expect(text(render())).toContain('Choose what happened');
  });
  it('confirms only clinician-entered work, permits unknown response and never calls note/AI/share routes', async () => {
    await edit();
    change('work-status', 'ADAPTED');
    change('work-done', 'Fictional adapted work');
    click('Confirm work & save');
    await vi.waitFor(() => expect(text(render())).toContain('Version 1 saved'));
    expect(JSON.parse(postCalls()[0][1].body).body.sessionWork).toEqual({
      ...sessionContext,
      disposition: 'ADAPTED',
      workDone: 'Fictional adapted work',
      clientResponse: '',
    });
    expect(
      h.fetch.mock.calls.every(([url]) => url === '/api/v1/clients/client-1/care-record'),
    ).toBe(true);
    expect(text(render())).toContain('no response or improvement is inferred');
  });
  it('keeps the same packet and freezes replacement after an uncertain save until its retry is acknowledged', async () => {
    await edit();
    change('work-status', 'USED');
    change('work-done', 'Fictional work');
    h.fetch.mockRejectedValueOnce(new TypeError('Lost response'));
    click('Confirm work & save');
    await vi.waitFor(() => expect(button('Retry the same save')).toBeDefined());
    expect(field('work-done').props.readOnly).toBe(true);
    expect(button('Discard unsaved draft').props.disabled).toBe(true);
    click('Retry the same save');
    await vi.waitFor(() => expect(text(render())).toContain('Version 1 saved'));
    expect(postCalls()).toHaveLength(2);
    expect(postCalls()[1][1].body).toBe(postCalls()[0][1].body);
  });
  it('preserves visible text after a concurrent conflict without rebasing or retrying over another record', async () => {
    await edit();
    change('work-status', 'PAUSED');
    change('work-done', 'Keep this fictional wording');
    h.fetch.mockResolvedValueOnce(Response.json({ error: 'Conflict' }, { status: 409 }));
    click('Confirm work & save');
    await vi.waitFor(() =>
      expect(text(render())).toContain('A newer record or a conflicting save exists'),
    );
    expect(field('work-done').props.value).toBe('Keep this fictional wording');
    expect(field('work-done').props.readOnly).toBe(true);
    expect(button('Confirm work & save').props.disabled).toBe(true);
    expect(postCalls()).toHaveLength(1);
  });
});
