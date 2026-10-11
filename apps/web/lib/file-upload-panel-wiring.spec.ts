import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Effect = () => void | (() => void);
type Slot =
  | { kind: 'state'; value: unknown }
  | { kind: 'ref'; value: { current: unknown } }
  | { kind: 'memo'; value: unknown; dependencies: readonly unknown[] }
  | { kind: 'effect'; run: Effect; dependencies?: readonly unknown[]; cleanup?: () => void };

// A deterministic component lifecycle harness, not a browser or real-audio test.
// The actual panel chooses when finalization and note generation may continue.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as Slot[],
  pending: new Set<number>(),
  writes: [] as unknown[],
}));
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  retry: vi.fn(),
  locks: new Set<() => void>(),
  owners: [] as Array<{ signal: AbortSignal; close: () => void }>,
}));

vi.mock('react', async (original) => {
  const actual = await original<typeof import('react')>();
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { kind: 'state', value: initial };
      const slot = hooks.slots[index];
      if (slot.kind !== 'state') throw new Error('Hook order changed');
      return [
        slot.value,
        (next: unknown) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
          hooks.writes.push(slot.value);
        },
      ];
    },
    useRef(initial: unknown) {
      const index = hooks.cursor++;
      hooks.slots[index] ??= { kind: 'ref', value: { current: initial } };
      const slot = hooks.slots[index];
      if (slot.kind !== 'ref') throw new Error('Hook order changed');
      return slot.value;
    },
    useMemo(make: () => unknown, dependencies: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (previous && previous.kind !== 'memo') throw new Error('Hook order changed');
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i])))
        hooks.slots[index] = { kind: 'memo', value: make(), dependencies };
      const slot = hooks.slots[index];
      if (slot.kind !== 'memo') throw new Error('Expected memo');
      return slot.value;
    },
    useEffect(run: Effect, dependencies?: readonly unknown[]) {
      const index = hooks.cursor++;
      const previous = hooks.slots[index];
      if (previous && previous.kind !== 'effect') throw new Error('Hook order changed');
      if (
        !previous ||
        !dependencies ||
        !previous.dependencies ||
        dependencies.some((value, i) => !Object.is(value, previous.dependencies?.[i]))
      ) {
        hooks.slots[index] = { kind: 'effect', run, dependencies, cleanup: previous?.cleanup };
        hooks.pending.add(index);
      }
    },
  };
});
vi.mock('./audio/audio-store-owner', () => ({
  AudioStoreOwner: class {
    private abort = new AbortController();
    constructor() {
      mocks.owners.push(this);
    }
    get signal() {
      return this.abort.signal;
    }
    async get() {
      this.signal.throwIfAborted();
      return {};
    }
    close() {
      this.abort.abort();
    }
  },
}));
vi.mock('./browser-capture-lock', () => ({
  subscribeBrowserCaptureLock(listener: () => void) {
    mocks.locks.add(listener);
    return () => mocks.locks.delete(listener);
  },
}));
vi.mock('./audio/upload-file', () => ({
  uploadAudioFile: mocks.upload,
  retryAudioUpload: mocks.retry,
  IncompleteAudioUploadError: class extends Error {},
  AudioFileStorageError: class extends Error {},
}));
vi.mock('../components/ui/Button', () => ({ Button: 'button' }));
vi.mock('../components/ui/Card', () => ({ Card: 'section' }));
vi.mock('../components/ui/Badge', () => ({ Badge: 'span' }));
vi.mock('../components/ui/Field', () => ({ Label: 'label', FieldError: 'span' }));

import { FileUploadPanel } from '../components/app/FileUploadPanel';

function render() {
  hooks.cursor = 0;
  const tree = FileUploadPanel({
    sessionId: 'session-a',
    clientName: 'Fictional client',
    modality: null,
    onFinished: vi.fn(),
  });
  for (const index of hooks.pending) {
    const slot = hooks.slots[index];
    if (slot.kind !== 'effect') throw new Error('Expected effect');
    slot.cleanup?.();
    slot.cleanup = slot.run() || undefined;
  }
  hooks.pending.clear();
  return tree;
}
function cleanup() {
  for (const slot of hooks.slots)
    if (slot.kind === 'effect') {
      slot.cleanup?.();
      slot.cleanup = undefined;
    }
}
type ElementProps = {
  type?: string;
  children?: React.ReactNode;
  onChange?: (event: { target: { files: File[] } }) => void;
  onClick?: () => Promise<void>;
};
function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<ElementProps>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function startUpload() {
  const picker = elements(render()).find((node) => node.props.type === 'file');
  if (!picker?.props.onChange) throw new Error('Missing file picker');
  picker.props.onChange({ target: { files: [new File(['test audio'], 'test.wav')] } });
  const button = elements(render()).find((node) => node.props.children === 'Decode + upload');
  if (!button?.props.onClick) throw new Error('Missing upload action');
  return button.props.onClick();
}
async function cancel(reason: 'auth lock' | 'unmount') {
  if (reason === 'auth lock') for (const listener of mocks.locks) listener();
  else cleanup();
  await Promise.resolve(); // Let unmount's StrictMode-safe cleanup run.
  expect(mocks.owners[0].signal.aborted).toBe(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.pending.clear();
  hooks.writes = [];
  mocks.owners = [];
  mocks.locks.clear();
  mocks.upload.mockResolvedValue({ durationMs: 1000, chunksWritten: 1 });
  vi.stubGlobal('React', React);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
});
afterEach(async () => {
  cleanup();
  await Promise.resolve();
  vi.unstubAllGlobals();
});

describe('file upload finalization lifecycle', () => {
  it.each(['auth lock', 'unmount'] as const)(
    'does not generate a note or update completion after %s during the end request',
    async (reason) => {
      const end = deferred<Response>();
      vi.mocked(fetch).mockImplementation((url) =>
        String(url).endsWith('/end') ? end.promise : Promise.resolve(new Response('{}')),
      );
      const uploaded = startUpload();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(mocks.owners[0].signal);
      await cancel(reason);
      const writesAtCancel = hooks.writes.length;

      // Model a transport that still delivers a successful late response.
      end.resolve(new Response('{}'));
      await uploaded;
      expect(fetch).toHaveBeenCalledOnce();
      expect(hooks.writes).toHaveLength(writesAtCancel);
      expect(hooks.writes).not.toContain('done');
    },
  );

  it.each(['auth lock', 'unmount'] as const)(
    'ignores stale error-body completion after %s',
    async (reason) => {
      const body = deferred<{ error: string }>();
      const json = vi.fn(() => body.promise);
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503, json } as unknown as Response);
      const uploaded = startUpload();
      await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
      await cancel(reason);
      const writesAtCancel = hooks.writes.length;
      body.resolve({ error: 'Old end response' });
      await uploaded;
      expect(fetch).toHaveBeenCalledOnce();
      expect(hooks.writes).toHaveLength(writesAtCancel);
      expect(hooks.writes).not.toContain('Old end response');
    },
  );

  it('still generates a note and offers review when the owner remains active', async () => {
    await startUpload();
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/sessions/session-a/end',
      '/api/v1/sessions/session-a/generate-note',
    ]);
    expect(elements(render()).some((node) => node.props.children === 'Review session')).toBe(true);
    expect(mocks.owners[0].signal.aborted).toBe(false);
  });
});
