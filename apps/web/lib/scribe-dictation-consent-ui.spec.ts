import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  stateIndex: 0,
  refIndex: 0,
  request: vi.fn(),
  review: vi.fn(),
}));
// The initial review load is independently tested by scribe-encounter-review;
// this hook harness enters its resolved idle state and exercises actual handlers.
// Capture children are stubs, so no microphone or recording is opened.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: <T>(initial: T) => {
    const index = h.stateIndex++;
    if (!(index in h.states)) h.states[index] = initial;
    return [
      h.states[index],
      (value: T | ((previous: T) => T)) => {
        h.states[index] =
          typeof value === 'function' ? (value as (previous: T) => T)(h.states[index] as T) : value;
      },
    ];
  },
  useRef: <T>(value: T) => {
    const index = h.refIndex++;
    return h.refs[index] ?? (h.refs[index] = { current: value });
  },
  useCallback: (fn: unknown) => fn,
  useEffect: () => undefined,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('./scribe-encounter-review', () => ({ loadScribeEncounterReview: h.review }));
vi.mock('../components/app/LiveRecorder', () => ({ LiveRecorder: 'dictation-capture' }));
vi.mock('../components/app/FileUploadPanel', () => ({ FileUploadPanel: 'upload-capture' }));
vi.mock('../components/app/ReviewAndSign', () => ({ ReviewAndSign: 'note-review' }));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
import { DoctorEncounterPanel } from '../components/app/DoctorEncounterPanel';
type Props = {
  children?: ReactNode;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  onChange?: (event: { target: { checked: boolean } }) => void;
  onClick?: () => Promise<void>;
};
const elements = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
let mode: 'dictate' | 'upload';
const render = () => {
  h.stateIndex = h.refIndex = 0;
  return DoctorEncounterPanel({
    sessionId: 'fictional-session',
    clientId: 'fictional-client',
    clientName: 'Fictional patient',
    sessionStatus: 'SCHEDULED',
    liveConsentDeclined: true,
    mode,
  });
};
const boxes = () =>
  elements(render()).filter(
    (element) => element.type === 'input' && element.props.type === 'checkbox',
  );
const action = () => elements(render()).find((element) => element.type === 'button')!;
const response = (status = 200) =>
  new Response(JSON.stringify(status === 200 ? {} : { error: 'Consent changed; retry.' }), {
    status,
  });
const checkAll = () => {
  for (let i = 0; i < 3; i++) boxes()[i]!.props.onChange!({ target: { checked: true } });
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.request);
  h.states = [{ kind: 'idle' }];
  h.refs = [];
  mode = 'dictate';
  h.request.mockResolvedValue(response());
});
afterEach(() => vi.unstubAllGlobals());
describe('Scribe dictation/upload explicit consent UI', () => {
  it.each(['dictate', 'upload'] as const)(
    'starts %s with three unchecked permissions and rejects stale incomplete clicks',
    async (value) => {
      mode = value;
      expect(boxes()).toHaveLength(3);
      expect(boxes().every((box) => box.props.checked === false)).toBe(true);
      expect(action().props.disabled).toBe(true);
      boxes()[0]!.props.onChange!({ target: { checked: true } });
      boxes()[1]!.props.onChange!({ target: { checked: true } });
      await action().props.onClick!();
      expect(h.request).not.toHaveBeenCalled();
      expect(
        elements(render()).some(
          (element) => element.type === 'dictation-capture' || element.type === 'upload-capture',
        ),
      ).toBe(false);
      expect(text(render())).toContain('Live recording declined.');
      expect(text(render())).toContain(
        value === 'upload'
          ? 'patient agreed to use of this recording'
          : 'not record the patient’s voice',
      );
    },
  );
  it.each([
    ['dictate', 'DICTATE', 'dictation-capture'],
    ['upload', 'UPLOAD', 'upload-capture'],
  ] as const)(
    'saves explicit %s scope before starting its matching capture mode',
    async (value, captureMode, component) => {
      mode = value;
      checkAll();
      await action().props.onClick!();
      expect(h.request).toHaveBeenCalledTimes(2);
      const [url, init] = h.request.mock.calls[0]!;
      expect(url).toBe('/api/v1/sessions/fictional-session/consent');
      expect(JSON.parse(init.body)).toMatchObject({
        captureMode,
        scopes: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
      });
      expect(h.request.mock.calls[1]?.[0]).toBe('/api/v1/sessions/fictional-session/start');
      expect(JSON.parse(h.request.mock.calls[1]?.[1].body)).toEqual({ captureMode });
      expect(elements(render()).some((element) => element.type === component)).toBe(true);
    },
  );
  it('never starts capture when the consent save fails and requires an explicit retry', async () => {
    h.request.mockResolvedValueOnce(response(409));
    checkAll();
    await action().props.onClick!();
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(text(render())).toContain('Consent changed; retry.');
    expect(action().props.disabled).toBe(false);
    expect(elements(render()).some((element) => element.type === 'dictation-capture')).toBe(false);
  });
  it('does not duplicate consent/start requests under repeated clicks', async () => {
    let resolve!: (res: Response) => void;
    h.request.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    checkAll();
    const begin = action().props.onClick!;
    const first = begin();
    await begin();
    expect(h.request).toHaveBeenCalledTimes(1);
    resolve(response());
    await first;
    expect(h.request).toHaveBeenCalledTimes(2);
  });
});
