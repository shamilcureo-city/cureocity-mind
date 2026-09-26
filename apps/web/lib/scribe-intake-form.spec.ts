import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';

const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
}));
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T | (() => T)) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states))
      harness.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    return [harness.states[index], (value: T) => (harness.states[index] = value)];
  },
  useRef: <T>(current: T) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current });
  },
  useEffect: (effect: () => (() => void) | void, deps?: readonly unknown[]) => {
    const index = harness.effectIndex++;
    const previous = harness.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i]))
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
  },
}));
vi.mock('../components/app/ScribeTransport', () => ({ useScribeFetch: () => harness.request }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Field', () => ({
  Input: 'input',
  Select: 'select',
  Textarea: 'textarea',
  CheckboxRow: 'checkbox-row',
}));
import { ScribeIntakeForm } from '../components/app/ScribeIntakeForm';

type Props = {
  children?: ReactNode;
  type?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (value: { target: { value: string } } | boolean) => void;
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
  harness.stateIndex = harness.refIndex = harness.effectIndex = 0;
  const view = ScribeIntakeForm();
  harness.queued.splice(0).forEach((run) => run());
  return view;
}
function field(label: string) {
  const wrapper = elements(render()).find(
    (item) => item.type === 'label' && text(item.props.children).startsWith(label),
  );
  expect(wrapper, `Missing field ${label}`).toBeDefined();
  return elements(wrapper!.props.children).find((item) => item.props.onChange)!;
}
function change(label: string, value: string) {
  field(label).props.onChange!({ target: { value } });
}
function acknowledge() {
  elements(render()).find((item) => String(item.type) === 'checkbox-row')!.props.onChange!(true);
}
function submit() {
  elements(render()).find((item) => item.type === 'form')!.props.onSubmit!({
    preventDefault: vi.fn(),
  });
}
function fill(name: string) {
  change('Your name', name);
  change('Reason for visit', `${name} concern`);
  acknowledge();
}
function deferred() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const hashA = '#owner=doctor-a&record=intake-a&token=token-a';
const hashB = '#owner=doctor-b&record=intake-b&token=token-b';
let surface: EventTarget & {
  location: { hash: string; pathname: string };
  history: { replaceState: ReturnType<typeof vi.fn> };
};
function navigate(hash: string, event = 'hashchange') {
  surface.location.hash = hash;
  surface.dispatchEvent(new Event(event));
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.queued = [];
  const location = { hash: hashA, pathname: '/p/scribe-intake' };
  surface = Object.assign(new EventTarget(), {
    location,
    history: { replaceState: vi.fn(() => (location.hash = '')) },
  });
  vi.stubGlobal('window', surface);
  vi.stubGlobal('React', React);
  render();
});
afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('public intake patient-link lifecycle', () => {
  it('clears all patient-entered fields and acknowledgement when link A changes to B', () => {
    fill('Patient A');
    change('You are submitting as', 'caregiver');
    change('Medicines currently', 'Patient A medicine');
    change('Known allergies', 'reported');
    change('Allergy details', 'Patient A allergy');
    change('Relevant history', 'Patient A history');
    change('Pulse', '80');
    change('Measured date', '2026-09-25T12:00');
    navigate(hashB);
    for (const label of [
      'Your name',
      'Reason for visit',
      'Medicines currently',
      'Relevant history',
      'Pulse',
      'Measured date',
    ])
      expect(field(label).props.value).toBe('');
    expect(field('You are submitting as').props.value).toBe('patient');
    expect(field('Known allergies').props.value).toBe('unknown');
    expect(
      elements(render()).find((item) => String(item.type) === 'checkbox-row')!.props.checked,
    ).toBe(false);
    expect(elements(render()).find((item) => item.type === 'button')!.props.disabled).toBe(true);
    expect(harness.request).not.toHaveBeenCalled();
    fill('Patient B');
    harness.request.mockReturnValue(new Promise(() => {}));
    submit();
    const body = JSON.parse(harness.request.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      psychologistId: 'doctor-b',
      recordId: 'intake-b',
      token: 'token-b',
      report: { authorName: 'Patient B', vitals: null },
    });
    expect(JSON.stringify(body)).not.toContain('Patient A');
  });

  it.each(['success', 'failure'] as const)(
    'ignores late A %s while B is submitting, even if the transport ignores abort',
    async (outcome) => {
      const first = deferred();
      const second = deferred();
      harness.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      fill('Patient A');
      submit();
      const firstSignal = harness.request.mock.calls[0][1].signal as AbortSignal;
      navigate(hashB);
      expect(firstSignal.aborted).toBe(true);
      fill('Patient B');
      submit();
      if (outcome === 'success') first.resolve(new Response(null, { status: 201 }));
      else first.reject(new Error('Old A request failed'));
      await Promise.resolve();
      expect(surface.history.replaceState).not.toHaveBeenCalled();
      expect(surface.location.hash).toBe(hashB);
      expect(text(render())).toContain('Submitting…');
      expect(text(render())).not.toContain('Old A request failed');
      expect(field('Your name').props.value).toBe('Patient B');
      second.resolve(new Response(null, { status: 201 }));
      await Promise.resolve();
      expect(text(render())).toContain('Submitted for doctor review');
      expect(surface.history.replaceState).toHaveBeenCalledOnce();
      expect(surface.location.hash).toBe('');
    },
  );

  it('guards stale submit and completion before the browser dispatches hashchange', async () => {
    fill('Patient A');
    const staleSubmit = elements(render()).find((item) => item.type === 'form')!.props.onSubmit!;
    surface.location.hash = hashB;
    staleSubmit({ preventDefault: vi.fn() });
    expect(harness.request).not.toHaveBeenCalled();
    navigate(hashA);
    const pending = deferred();
    harness.request.mockReturnValue(pending.promise);
    submit();
    surface.location.hash = hashB;
    pending.resolve(new Response(null, { status: 201 }));
    await Promise.resolve();
    expect(surface.history.replaceState).not.toHaveBeenCalled();
    expect(text(render())).not.toContain('Submitted for doctor review');
    navigate(hashB);
    expect(field('Your name').props.value).toBe('');
  });

  it('rejects an old rendered submit handler after the link event but before React rerenders', () => {
    fill('Patient A');
    const staleSubmit = elements(render()).find((item) => item.type === 'form')!.props.onSubmit!;
    navigate(hashB);
    staleSubmit({ preventDefault: vi.fn() });
    expect(harness.request).not.toHaveBeenCalled();
    navigate(hashA);
    staleSubmit({ preventDefault: vi.fn() });
    expect(harness.request).not.toHaveBeenCalled();
    expect(field('Your name').props.value).toBe('');
  });

  it('handles history navigation, avoids duplicate-event resets, and leaves old requests inert on unmount', async () => {
    fill('Patient A');
    navigate(hashB, 'popstate');
    expect(field('Your name').props.value).toBe('');
    fill('Patient B');
    navigate(hashB);
    expect(field('Your name').props.value).toBe('Patient B');
    const pending = deferred();
    harness.request.mockReturnValue(pending.promise);
    submit();
    const signal = harness.request.mock.calls[0][1].signal as AbortSignal;
    harness.effects.forEach((effect) => effect.cleanup?.());
    harness.effects = [];
    expect(signal.aborted).toBe(true);
    pending.resolve(new Response(null, { status: 201 }));
    await Promise.resolve();
    expect(surface.history.replaceState).not.toHaveBeenCalled();
  });
});
