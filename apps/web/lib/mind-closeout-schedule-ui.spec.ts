import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  request: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  skip: vi.fn(),
  scheduled: vi.fn(),
  confirm: vi.fn(),
  guard: vi.fn(),
  modal: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [
      harness.states[index],
      (next: T | ((previous: T) => T)) => {
        harness.states[index] =
          typeof next === 'function'
            ? (next as (previous: T) => T)(harness.states[index] as T)
            : next;
      },
    ];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useMemo: <T>(make: () => T) => make(),
  useEffect: () => undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: harness.refresh }) }));
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/ui/Field', () => ({
  Input: 'input',
  Label: 'label',
  Select: 'select',
  FieldError: 'field-error',
}));
vi.mock('../components/app/UpgradeModal', () => ({ UpgradeModal: 'upgrade-modal' }));
vi.mock('../components/app/CreateClientModal', () => ({
  CreateClientModal: 'create-client-modal',
}));
vi.mock('./use-unsaved-work-guard', () => ({ useUnsavedWorkGuard: harness.guard }));
vi.mock('./use-modal-a11y', () => ({ useModalA11y: harness.modal }));
vi.mock('./mind-closeout-task-status', () => ({ useMindCloseoutTaskStatus: vi.fn() }));

import { ScheduleSessionPanel } from '../components/app/ScheduleSessionPanel';

type Props = {
  children?: ReactNode;
  id?: string;
  value?: string;
  role?: string;
  message?: string;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => Promise<void>;
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
const client = { id: 'fictional-client', fullName: 'Fictional client', preferredModality: null };
type ModalProps = {
  open: boolean;
  onUnconfirmedBookingChange: (value: boolean) => void;
  clients: (typeof client)[];
  initialClientId: string;
  initialDate: string;
  initialTime: string;
  closeoutMode: boolean;
  sourceSessionId: string;
  canSkipFollowUp: boolean;
  onSkip: () => Promise<void>;
  onClose: () => void;
  onScheduled: (value: unknown) => void;
};
let Modal: (props: ModalProps) => ReactNode;
let parentModalProps: ModalProps;
function render(overrides: Partial<ModalProps> = {}) {
  harness.stateIndex = harness.refIndex = 0;
  return Modal({
    ...parentModalProps,
    onClose: harness.close,
    onSkip: harness.skip,
    onScheduled: harness.scheduled,
    ...overrides,
  });
}
function button(label: string, view = render()) {
  const match = elements(view).find(
    (node) => node.type === 'button' && text(node.props.children) === label,
  );
  expect(match, `Missing action ${label}`).toBeDefined();
  return match!;
}
function editDate(value: string) {
  elements(render()).find((node) => node.props.id === 'sched-date')!.props.onChange!({
    target: { value },
  });
}
async function submit() {
  await elements(render()).find((node) => node.type === 'form')!.props.onSubmit!({
    preventDefault: vi.fn(),
  });
}

beforeEach(() => {
  Object.values(harness).forEach((item) => {
    if (vi.isMockFunction(item)) item.mockReset();
  });
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', harness.request);
  vi.stubGlobal('window', { confirm: harness.confirm });
  harness.states = [true]; // Open the public component and get its actual internal modal.
  harness.refs = [];
  harness.stateIndex = harness.refIndex = 0;
  const view = ScheduleSessionPanel({
    clients: [client],
    initialClientId: client.id,
    initialDate: '2100-01-01',
    initialTime: '10:00',
    closeoutMode: true,
    sourceSessionId: 'fictional-session',
    canSkipFollowUp: true,
  });
  const modal = elements(view).find(
    (node) => typeof node.type === 'function' && node.type.name === 'ScheduleModal',
  )!;
  Modal = modal.type as unknown as typeof Modal;
  parentModalProps = modal.props as unknown as ModalProps;
  harness.states = [];
  harness.refs = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('Mind closeout appointment safety', () => {
  it('does not offer the forbidden follow-up decision to a documentation-only account', () => {
    const view = render({ canSkipFollowUp: false });
    expect(text(view)).not.toContain('Skip follow-up');
    expect(text(view)).toContain('Schedule next session');
    expect(harness.request).not.toHaveBeenCalled();
  });

  it('asks before discarding edits and preserves the date when the user stays', () => {
    render();
    editDate('2100-02-02');
    harness.confirm.mockReturnValue(false);
    button('Cancel').props.onClick!();
    expect(harness.confirm).toHaveBeenCalledWith('Discard the unsaved appointment changes?');
    expect(harness.close).not.toHaveBeenCalled();
    expect(elements(render()).find((node) => node.props.id === 'sched-date')?.props.value).toBe(
      '2100-02-02',
    );
    expect(harness.guard).toHaveBeenLastCalledWith(true, expect.any(String), false);
  });

  it('does not call skip when the user declines discarding an appointment draft', () => {
    render();
    editDate('2100-02-02');
    harness.confirm.mockReturnValue(false);
    button('Skip follow-up').props.onClick!();
    expect(harness.skip).not.toHaveBeenCalled();
    expect(elements(render()).find((node) => node.props.id === 'sched-date')?.props.value).toBe(
      '2100-02-02',
    );
  });

  it('retains form values after a booking failure and warns that a network failure is not proof of no booking', async () => {
    render();
    editDate('2100-02-02');
    harness.request.mockRejectedValueOnce(new TypeError('Network disconnected'));
    await submit();
    expect(harness.scheduled).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
    expect(text(render())).toContain('The previous request may have been saved');
    expect(text(render())).toContain('Your note and agreements are unchanged');
    expect(elements(render()).find((node) => node.props.id === 'sched-date')?.props.value).toBe(
      '2100-02-02',
    );
    expect(button('Skip follow-up').props.disabled).toBe(true);
    expect(button('Schedule').props.disabled).toBe(true);
    await submit();
    expect(harness.request).toHaveBeenCalledOnce();
    // Closing an uncertain attempt hides its still-mounted editor rather than discarding.
    button('Cancel').props.onClick!();
    expect(harness.close).toHaveBeenCalledOnce();
    expect(harness.confirm).not.toHaveBeenCalled();
    expect(
      elements(render({ open: false })).find((node) => node.props.id === 'sched-date')?.props.value,
    ).toBe('2100-02-02');
  });

  it('blocks a repeated non-source booking after a lost reply, even through the submit handler', async () => {
    harness.request.mockRejectedValueOnce(new TypeError('Lost reply'));
    const sourceFree = { closeoutMode: false, sourceSessionId: undefined };
    const first = elements(render(sourceFree)).find((node) => node.type === 'form')!;
    await first.props.onSubmit!({ preventDefault: vi.fn() });
    const repeated = elements(render(sourceFree)).find((node) => node.type === 'form')!;
    await repeated.props.onSubmit!({ preventDefault: vi.fn() });
    expect(harness.request).toHaveBeenCalledOnce();
    expect(button('Schedule', render(sourceFree)).props.disabled).toBe(true);
    expect(harness.scheduled).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { id: '', clientId: client.id, scheduledAt: '2100-01-01T10:00:00.000Z' },
    { id: 'appointment', clientId: 'wrong-client', scheduledAt: '2100-01-01T10:00:00.000Z' },
  ])('keeps the form for an unverifiable HTTP 200 receipt %j', async (body) => {
    render();
    editDate('2100-02-02');
    harness.request.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    await submit();
    expect(harness.scheduled).not.toHaveBeenCalled();
    expect(harness.close).not.toHaveBeenCalled();
    expect(button('Schedule').props.disabled).toBe(true);
    expect(text(render())).toContain('previous request may have been saved');
    expect(elements(render()).find((node) => node.props.id === 'sched-date')?.props.value).toBe(
      '2100-02-02',
    );
  });

  it('keeps a known validation failure separate from uncertain network delivery', async () => {
    harness.request.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Choose a different time.' }), { status: 422 }),
    );
    await submit();
    expect(text(render())).not.toContain('previous request may have been saved');
    expect(elements(render()).find((node) => node.type === 'field-error')?.props.message).toBe(
      'Choose a different time.',
    );
    expect(harness.scheduled).not.toHaveBeenCalled();
  });

  it('blocks closing and duplicate submits while a booking is in flight', async () => {
    let resolve!: (response: Response) => void;
    harness.request.mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const view = render();
    const form = elements(view).find((node) => node.type === 'form')!;
    const first = form.props.onSubmit!({ preventDefault: vi.fn() });
    await form.props.onSubmit!({ preventDefault: vi.fn() });
    button('Cancel', view).props.onClick!();
    expect(harness.request).toHaveBeenCalledOnce();
    expect(harness.close).not.toHaveBeenCalled();
    resolve(new Response(JSON.stringify({ error: 'Choose a different time.' }), { status: 422 }));
    await first;
  });

  it('does not treat an unrelated HTTP 200 as a saved follow-up skip', async () => {
    harness.request.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          sessionId: 'other-session',
          followUpSkippedAt: '2026-09-14T12:00:00.000Z',
        }),
      ),
    );
    await expect(parentModalProps.onSkip()).rejects.toThrow('could not be confirmed');
    expect(harness.refresh).not.toHaveBeenCalled();
  });
});
