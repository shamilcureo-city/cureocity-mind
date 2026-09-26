import * as React from 'react';
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  MedicalEncounterNoteV1Schema,
  type MedicalEncounterNoteV1,
  type MedicalEvidenceField,
  type RxPadDraft,
} from '@cureocity/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRANSCRIPT_UNAVAILABLE_MESSAGE } from './note-transcript-view';
import type { ScribeSourceSnapshot } from './scribe-source-review';

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  callbacks: [] as { deps: readonly unknown[]; callback: unknown }[],
  queued: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  callbackIndex: 0,
  request: vi.fn(),
  sign: vi.fn(),
  signed: vi.fn(),
}));

// Run the actual rendered handlers with deterministic hook state. Child
// workflows are stubs; these tests do not claim DOM, browser or clinical validation.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
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
  useCallback: <T>(callback: T, deps: readonly unknown[]) => {
    const index = h.callbackIndex++;
    const previous = h.callbacks[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i]))
      h.callbacks[index] = { callback, deps };
    return h.callbacks[index].callback;
  },
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = h.effectIndex++;
    const previous = h.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i])) {
      h.queued.push(() => {
        previous?.cleanup?.();
        h.effects[index] = { deps, cleanup: effect() || undefined };
      });
    }
  },
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'div' }));
vi.mock('../components/app/MedicalNoteView', () => ({ MedicalNoteView: 'medical-note' }));
vi.mock('../components/app/MedicalNoteEditor', () => ({
  MedicalNoteEditor: 'medical-note-editor',
}));
vi.mock('../components/app/ScribeSourceComparison', () => ({
  ScribeSourceComparison: 'source-comparison',
}));
vi.mock('../components/app/ScribeCodingWorkspace', () => ({
  ScribeCodingWorkspace: 'coding-workspace',
}));
vi.mock('../components/app/VitalsEntryCard', () => ({ VitalsEntryCard: 'vitals' }));
vi.mock('../components/app/PlanComposer', () => ({ PlanComposer: 'plan-composer' }));
vi.mock('../components/app/EncounterDifferentialPanel', () => ({
  EncounterDifferentialPanel: 'differential',
}));
vi.mock('../components/app/EncounterOrdersPanel', () => ({ EncounterOrdersPanel: 'orders' }));
vi.mock('../components/app/EncounterInteropPanel', () => ({ EncounterInteropPanel: 'interop' }));
vi.mock('./sign-note', () => ({ postSignNote: h.sign }));
import { ReviewAndSign } from '../components/app/ReviewAndSign';

type Props = {
  children?: ReactNode;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { checked: boolean } }) => void;
  onSave?: (note: MedicalEncounterNoteV1, edits: unknown[]) => void;
  onPadChange?: (hasContent: boolean, pad: RxPadDraft | null) => void;
  open?: boolean;
  source?: ScribeSourceSnapshot | null;
  error?: string | null;
  loading?: boolean;
  note?: MedicalEncounterNoteV1;
  activeField?: MedicalEvidenceField;
  onReviewSource?: (field: MedicalEvidenceField) => void;
  onFieldFocus?: (field: MedicalEvidenceField) => void;
  onSelectField?: (field: MedicalEvidenceField) => void;
  onRetry?: () => void;
  onClose?: () => void;
  onWorkChange?: (blocked: boolean) => void;
};
const elements = (node: ReactNode): ReactElement<Props>[] =>
  Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...elements(child.props.children)] : [],
  );
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) => (isValidElement<Props>(child) ? text(child.props.children) : String(child)))
    .join('');
const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional clinical history',
});
let props: Parameters<typeof ReviewAndSign>[0];
let incomplete = true;
const status = () => ({
  incomplete,
  reason: incomplete ? 'audio_loss' : null,
  draftId: 'draft-1',
  reviewToken: 'a'.repeat(64),
});
const transcript = 'Fictional captured conversation for review.';
const comparisonSnapshot = (
  overrides: Partial<ScribeSourceSnapshot> = {},
): ScribeSourceSnapshot => ({
  draftId: 'draft-1',
  version: 'a'.repeat(64),
  draftContent: note,
  transcript,
  sourceState: 'available',
  sourceMessage: null,
  ...overrides,
});
function render() {
  h.stateIndex = h.refIndex = h.effectIndex = h.callbackIndex = 0;
  const view = ReviewAndSign(props);
  h.queued.splice(0).forEach((run) => run());
  return view;
}
function element(type: string) {
  return elements(render()).find((node) => node.type === type);
}
function button(label: string) {
  return elements(render()).find(
    (node) => node.type === 'button' && text(node.props.children) === label,
  );
}
function click(label: string) {
  const control = button(label);
  expect(control, `Missing button: ${label}`).toBeDefined();
  expect(control!.props.disabled, `Disabled button: ${label}`).not.toBe(true);
  control!.props.onClick!();
}
function checkReview() {
  const checkbox = elements(render()).find(
    (node) => node.type === 'input' && node.props.type === 'checkbox',
  );
  expect(checkbox?.props.disabled).not.toBe(true);
  checkbox!.props.onChange!({ target: { checked: true } });
}
const reviewGets = () =>
  h.request.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/capture-review') && init?.method !== 'POST',
  );
const reviewPosts = () =>
  h.request.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/capture-review') && init?.method === 'POST',
  );
async function loadedIncomplete() {
  render();
  await vi.waitFor(() => expect(text(render())).toContain(transcript));
}
async function reviewed() {
  await loadedIncomplete();
  checkReview();
  click('Record capture review');
  await vi.waitFor(() => expect(button('Capture review recorded')).toBeDefined());
  expect(button('Confirm & sign')?.props.disabled).toBe(false);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  h.states = [];
  h.refs = [];
  h.effects = [];
  h.callbacks = [];
  h.queued = [];
  props = { sessionId: 'session-1', clientId: 'client-1', note, onSigned: h.signed };
  incomplete = true;
  vi.stubGlobal('React', React);
  vi.stubGlobal('fetch', h.request);
  h.request.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/capture-review'))
      return Response.json(init?.method === 'POST' ? { ...status(), reviewed: true } : status());
    if (url.endsWith('/note-draft')) return Response.json({ transcript });
    if (url.endsWith('/source-review')) return Response.json(comparisonSnapshot());
    throw new Error(`Unexpected request: ${url}`);
  });
  h.sign.mockResolvedValue(Response.json({ id: 'note-1' }, { status: 201 }));
});
afterEach(() => {
  h.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe('Scribe capture review actual control handlers', () => {
  it('blocks signing over unsaved coding edits without treating coding as capture review', async () => {
    await loadedIncomplete();
    const coding = element('coding-workspace');
    expect(coding).toBeDefined();
    coding!.props.onWorkChange!(true);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    coding!.props.onWorkChange!(false);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(reviewPosts()).toHaveLength(0);
    await reviewed();
    element('coding-workspace')!.props.onWorkChange!(true);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(text(render())).toContain('Save or discard your coding worksheet edits before signing');
    element('coding-workspace')!.props.onWorkChange!(false);
    expect(button('Confirm & sign')?.props.disabled).toBe(false);
  });

  it('loads saved source only on explicit comparison and keeps section focus in sync', async () => {
    incomplete = false;
    render();
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
    expect(h.request.mock.calls.some(([url]) => String(url).endsWith('/source-review'))).toBe(
      false,
    );
    click('Compare with source');
    await vi.waitFor(() =>
      expect(element('source-comparison')?.props.source?.transcript).toBe(transcript),
    );
    expect(element('source-comparison')?.props.open).toBe(true);
    expect(reviewPosts()).toHaveLength(0);
    element('medical-note')!.props.onReviewSource!('plan');
    expect(element('source-comparison')?.props.activeField).toBe('plan');
    click('Edit note');
    element('medical-note-editor')!.props.onFieldFocus!('vitals');
    expect(element('source-comparison')?.props.activeField).toBe('vitals');
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
  });

  it('does not turn source comparison into incomplete-capture approval', async () => {
    await loadedIncomplete();
    click('Compare with source');
    await vi.waitFor(() => expect(element('source-comparison')?.props.source).not.toBeNull());
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    button('Confirm & sign')!.props.onClick!();
    expect(h.sign).not.toHaveBeenCalled();
    expect(reviewPosts()).toHaveLength(0);
    expect(button('Record capture review')?.props.disabled).toBe(true);
  });

  it('aborts a closed comparison and ignores its late source response after reopening', async () => {
    incomplete = false;
    const old = deferred<Response>();
    const latest = deferred<Response>();
    let sourceCalls = 0;
    h.request.mockImplementation(async (url: string) =>
      url.endsWith('/source-review')
        ? sourceCalls++ === 0
          ? old.promise
          : latest.promise
        : Response.json(status()),
    );
    render();
    click('Compare with source');
    render();
    const pending = h.request.mock.calls.find(([url]) => String(url).endsWith('/source-review'))!;
    element('source-comparison')!.props.onClose!();
    render();
    expect((pending[1].signal as AbortSignal).aborted).toBe(true);
    expect(element('source-comparison')?.props.source).toBeNull();
    click('Compare with source');
    render();
    latest.resolve(
      Response.json(
        comparisonSnapshot({ version: 'b'.repeat(64), transcript: 'New saved source.' }),
      ),
    );
    await vi.waitFor(() =>
      expect(element('source-comparison')?.props.source?.transcript).toBe('New saved source.'),
    );
    const json = vi.fn(async () => comparisonSnapshot({ transcript: 'Old private source.' }));
    old.resolve({ ok: true, json } as unknown as Response);
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    expect(element('source-comparison')?.props.source?.transcript).toBe('New saved source.');
  });

  it('retains applied clinician corrections through failed and successful source refreshes', async () => {
    incomplete = false;
    render();
    click('Edit note');
    const corrected = { ...note, assessment: 'Clinician correction, not yet signed.' };
    element('medical-note-editor')!.props.onSave!(corrected, [
      { field: 'assessment', before: '', after: corrected.assessment },
    ]);
    click('Compare with source');
    await vi.waitFor(() => expect(element('source-comparison')?.props.source).not.toBeNull());
    h.request.mockResolvedValueOnce(Response.json({ invalid: true }));
    element('source-comparison')!.props.onRetry!();
    await vi.waitFor(() =>
      expect(element('source-comparison')?.props.error).toContain('could not be verified'),
    );
    expect(element('source-comparison')?.props.source).toBeNull();
    expect(element('medical-note')?.props.note).toEqual(corrected);
    element('source-comparison')!.props.onRetry!();
    await vi.waitFor(() => expect(element('source-comparison')?.props.source).not.toBeNull());
    expect(element('medical-note')?.props.note).toEqual(corrected);
    expect(reviewPosts()).toHaveLength(0);
    expect(h.sign).not.toHaveBeenCalled();
  });

  it('hides a previous session source immediately and cancels its pending fetch on unmount', async () => {
    incomplete = false;
    render();
    click('Compare with source');
    await vi.waitFor(() => expect(element('source-comparison')?.props.source).not.toBeNull());
    const pending = deferred<Response>();
    h.request.mockImplementation(async (url: string) =>
      url.endsWith('/source-review') ? pending.promise : Response.json(status()),
    );
    props = { ...props, sessionId: 'session-2' };
    const changed = render();
    expect(
      elements(changed).find((node) => node.type === 'source-comparison')?.props.source,
    ).toBeNull();
    const request = h.request.mock.calls.find(
      ([url]) => String(url) === '/api/v1/sessions/session-2/source-review',
    )!;
    h.effects.forEach((effect) => effect.cleanup?.());
    expect((request[1].signal as AbortSignal).aborted).toBe(true);
  });

  it('blocks signing while capture status is loading, including direct invocation of its handler', async () => {
    const pending = deferred<Response>();
    h.request.mockReturnValueOnce(pending.promise);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(text(render())).toContain('Checking capture completeness');
    button('Confirm & sign')!.props.onClick!();
    expect(h.sign).not.toHaveBeenCalled();
    incomplete = false;
    pending.resolve(Response.json(status()));
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
  });

  it.each(['idle', 'saving', 'error'] as const)(
    'requires successful draft saving before capture review or sign (%s)',
    (captureSaveState) => {
      props = { ...props, captureSaveState };
      expect(button('Confirm & sign')?.props.disabled).toBe(true);
      button('Confirm & sign')!.props.onClick!();
      expect(h.request).not.toHaveBeenCalled();
      expect(h.sign).not.toHaveBeenCalled();
    },
  );

  it('fails closed when status cannot be loaded and supports an explicit retry', async () => {
    h.request.mockResolvedValueOnce(
      Response.json({ error: 'Status unavailable' }, { status: 503 }),
    );
    render();
    await vi.waitFor(() => expect(button('Reload capture status')).toBeDefined());
    expect(text(render())).toContain('Status unavailable');
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    incomplete = false;
    click('Reload capture status');
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
    expect(reviewGets()).toHaveLength(2);
  });

  it('requires loaded source, explicit acknowledgement and a successful review POST before signing', async () => {
    const source = deferred<Response>();
    const review = deferred<Response>();
    h.request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/note-draft')) return source.promise;
      return init?.method === 'POST' ? review.promise : Response.json(status());
    });
    render();
    await vi.waitFor(() => expect(text(render())).toContain('Loading captured words'));
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    checkReview();
    expect(button('Record capture review')?.props.disabled).toBe(true);
    expect(reviewPosts()).toHaveLength(0);
    source.resolve(Response.json({ transcript }));
    await vi.waitFor(() => expect(button('Record capture review')?.props.disabled).toBe(false));
    click('Record capture review');
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(button('Recording review…')?.props.disabled).toBe(true);
    expect(JSON.parse(reviewPosts()[0][1].body)).toEqual({
      resolution: 'reviewed_and_completed',
      reviewedDraftId: 'draft-1',
      reviewToken: 'a'.repeat(64),
      reviewedNote: note,
    });
    review.resolve(Response.json({ ...status(), reviewed: true }));
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
    click('Confirm & sign');
    await vi.waitFor(() => expect(h.signed).toHaveBeenCalledOnce());
    expect(h.sign).toHaveBeenCalledWith('session-1', expect.objectContaining({ note }));
  });

  it('does not treat an unreadable source as an empty transcript that can be reviewed', async () => {
    h.request.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith('/note-draft')
          ? { transcript: null, errorMessage: TRANSCRIPT_UNAVAILABLE_MESSAGE }
          : status(),
      ),
    );
    render();
    await vi.waitFor(() => expect(text(render())).toContain(TRANSCRIPT_UNAVAILABLE_MESSAGE));
    checkReview();
    expect(button('Record capture review')?.props.disabled).toBe(true);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(button('Retry loading transcript')).toBeDefined();
    expect(reviewPosts()).toHaveLength(0);
  });

  it('invalidates review when the clinician edits the note and binds the next review to those corrections', async () => {
    await reviewed();
    click('Edit note');
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    const corrected = { ...note, assessment: 'Completed clinician assessment' };
    element('medical-note-editor')!.props.onSave!(corrected, [
      { field: 'assessment', before: '', after: corrected.assessment },
    ]);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(button('Record capture review')?.props.disabled).toBe(true);
    checkReview();
    click('Record capture review');
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
    expect(JSON.parse(reviewPosts()[1][1].body).reviewedNote).toEqual(corrected);
  });

  it('invalidates review and refreshes the saved review identity after the prescription changes', async () => {
    element('plan-composer')!.props.onPadChange!(false, null);
    await reviewed();
    const before = reviewGets().length;
    element('plan-composer')!.props.onPadChange!(true, {
      version: 'V1',
      adviceLines: ['Corrected advice'],
    });
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(reviewGets()).toHaveLength(before + 1);
    await vi.waitFor(() => expect(text(render())).not.toContain('Checking capture completeness'));
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(button('Record capture review')?.props.disabled).toBe(true);
  });

  it('drops local approval and reloads capture review when signing fails', async () => {
    await reviewed();
    const before = reviewGets().length;
    h.sign.mockResolvedValueOnce(
      Response.json({ error: 'The saved source changed; review again.' }, { status: 409 }),
    );
    click('Confirm & sign');
    await vi.waitFor(() => expect(reviewGets()).toHaveLength(before + 1));
    expect(text(render())).toContain('The saved source changed; review again.');
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(h.signed).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(text(render())).not.toContain('Checking capture completeness'));
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(button('Record capture review')?.props.disabled).toBe(true);
    expect(reviewGets().at(-1)?.[1]).toEqual({ cache: 'no-store' });
  });

  it('does not approve a refreshed review identity using the previous displayed transcript', async () => {
    element('plan-composer')!.props.onPadChange!(false, null);
    await reviewed();
    const refreshedSource = deferred<Response>();
    h.request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/note-draft')) return refreshedSource.promise;
      return Response.json({
        ...status(),
        reviewToken: 'b'.repeat(64),
        reviewed: init?.method === 'POST',
      });
    });
    element('plan-composer')!.props.onPadChange!(true, { adviceLines: ['Changed advice'] });
    await vi.waitFor(() => expect(text(render())).toContain('Loading captured words'));
    expect(text(render())).not.toContain(transcript);
    checkReview();
    expect(button('Record capture review')?.props.disabled).toBe(true);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(reviewPosts()).toHaveLength(1);
    refreshedSource.resolve(Response.json({ transcript: 'Freshly loaded fictional transcript.' }));
    await vi.waitFor(() => expect(button('Record capture review')?.props.disabled).toBe(false));
    click('Record capture review');
    await vi.waitFor(() => expect(button('Confirm & sign')?.props.disabled).toBe(false));
    expect(JSON.parse(reviewPosts()[1][1].body).reviewToken).toBe('b'.repeat(64));
  });

  it('ignores an old pending transcript response that resolves during capture-status refresh', async () => {
    const oldSource = deferred<Response>();
    const refreshedStatus = deferred<Response>();
    const freshSource = deferred<Response>();
    let sourceRequests = 0;
    let statusRequests = 0;
    h.request.mockImplementation(async (url: string) => {
      if (url.endsWith('/note-draft'))
        return sourceRequests++ === 0 ? oldSource.promise : freshSource.promise;
      return statusRequests++ === 0 ? Response.json(status()) : refreshedStatus.promise;
    });
    element('plan-composer')!.props.onPadChange!(false, null);
    await vi.waitFor(() => {
      render();
      expect(sourceRequests).toBe(1);
    });
    element('plan-composer')!.props.onPadChange!(true, { adviceLines: ['Updated advice'] });
    expect(statusRequests).toBe(2);
    expect(text(render())).toContain('Checking capture completeness');

    const oldJson = vi
      .fn()
      .mockResolvedValue({ transcript: 'Stale source from the previous request.' });
    oldSource.resolve({ ok: true, json: oldJson } as unknown as Response);
    await vi.waitFor(() => expect(oldJson).toHaveBeenCalledOnce());
    expect(text(render())).not.toContain('Stale source from the previous request.');

    refreshedStatus.resolve(Response.json({ ...status(), reviewToken: 'b'.repeat(64) }));
    await vi.waitFor(() => {
      render();
      expect(sourceRequests).toBe(2);
    });
    checkReview();
    expect(button('Record capture review')?.props.disabled).toBe(true);
    expect(button('Confirm & sign')?.props.disabled).toBe(true);
    expect(text(render())).toContain('Loading captured words');
    expect(text(render())).not.toContain('Stale source from the previous request.');

    freshSource.resolve(Response.json({ transcript: 'Current source for the refreshed review.' }));
    await vi.waitFor(() => expect(button('Record capture review')?.props.disabled).toBe(false));
    expect(text(render())).toContain('Current source for the refreshed review.');
  });
});
