import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  memo: undefined as unknown,
  index: 0,
  effects: [] as { deps?: readonly unknown[]; cleanup?: () => void }[],
  queued: [] as (() => void)[],
  fetch: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('react', () => ({
  useReducer: () => [0, vi.fn()],
  useMemo: (factory: () => unknown) => harness.memo ?? (harness.memo = factory()),
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
    const index = harness.index++;
    const previous = harness.effects[index];
    if (!previous || !deps || deps.some((dep, i) => dep !== previous.deps?.[i])) {
      harness.queued.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() || undefined };
      });
    }
  },
}));
import { useMindInstrumentDrafts } from './use-mind-instrument-drafts';

const listeners = new Map<string, (event: never) => void>();
class FakeElement {
  closest() {
    return this;
  }
}
class FakeAnchor extends FakeElement {
  target = '';
  href = 'https://mind.example.test/app/today';
  hasAttribute() {
    return false;
  }
}
function render() {
  harness.index = 0;
  const controller = useMindInstrumentDrafts('fictional-client', false);
  for (const effect of harness.queued.splice(0)) effect();
  return controller;
}
function linkClick() {
  const event = {
    target: new FakeAnchor(),
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  listeners.get('click')?.(event as never);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  harness.memo = undefined;
  harness.index = 0;
  harness.effects = [];
  harness.queued = [];
  harness.confirm.mockReturnValue(false);
  const addEventListener = (key: string, listener: (event: never) => void) =>
    listeners.set(key, listener);
  const removeEventListener = (key: string) => listeners.delete(key);
  vi.stubGlobal('window', {
    confirm: harness.confirm,
    addEventListener,
    removeEventListener,
    navigation: { addEventListener, removeEventListener },
  });
  vi.stubGlobal('document', { addEventListener, removeEventListener });
  vi.stubGlobal('location', {
    href: 'https://mind.example.test/app/clients/fictional-client/journey',
    pathname: '/app/clients/fictional-client/journey',
    search: '',
  });
  vi.stubGlobal('Element', FakeElement);
  vi.stubGlobal('HTMLAnchorElement', FakeAnchor);
  vi.stubGlobal('fetch', harness.fetch);
  harness.fetch.mockImplementation(async () =>
    Response.json({
      instrumentKey: 'PHQ9',
      language: 'en',
      revision: 0,
      status: 'ACTIVE',
      responses: {},
      updatedAt: null,
      submittedResponseId: null,
      riskFlagged: false,
    }),
  );
});
afterEach(() => {
  for (const effect of harness.effects) effect.cleanup?.();
  vi.unstubAllGlobals();
});

describe('draft hook uses the shared real in-app navigation guard', () => {
  it('blocks a Next-style internal link while autosave is pending, without offering to interrupt the write', async () => {
    const controller = render();
    await controller.load('PHQ9');
    let release: (response: Response) => void = () => undefined;
    harness.fetch.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    controller.answer('PHQ9', 'phq9_1', 2);
    render();
    const event = linkClick();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(harness.confirm).not.toHaveBeenCalled();
    release(
      Response.json({
        instrumentKey: 'PHQ9',
        language: 'en',
        revision: 1,
        status: 'ACTIVE',
        responses: { phq9_1: 2 },
        updatedAt: '2026-09-10T00:00:00.000Z',
        submittedResponseId: null,
        riskFlagged: false,
      }),
    );
    await controller.flush('PHQ9');
    render();
    expect(listeners.has('click')).toBe(false);
    expect(listeners.has('beforeunload')).toBe(false);
  });

  it('protects failed answers from internal-link navigation unless the clinician explicitly leaves', async () => {
    const controller = render();
    await controller.load('PHQ9');
    harness.fetch.mockRejectedValue(new Error('Offline'));
    controller.answer('PHQ9', 'phq9_1', 2);
    await expect(controller.flush('PHQ9')).rejects.toThrow('Offline');
    render();
    expect(linkClick().preventDefault).toHaveBeenCalled();
    expect(harness.confirm).toHaveBeenCalledWith(expect.stringContaining('not confirmed saved'));
    expect(controller.entry('PHQ9').answers).toEqual({ phq9_1: 2 });
    harness.confirm.mockReturnValue(true);
    expect(linkClick().preventDefault).not.toHaveBeenCalled();
  });

  it('uses the same guard for same-document Back/Forward where Navigation API supports interception', async () => {
    const controller = render();
    await controller.load('PHQ9');
    harness.fetch.mockRejectedValue(new Error('Offline'));
    controller.answer('PHQ9', 'phq9_1', 2);
    await expect(controller.flush('PHQ9')).rejects.toThrow('Offline');
    render();
    const event = {
      cancelable: true,
      canIntercept: true,
      hashChange: false,
      preventDefault: vi.fn(),
    };
    listeners.get('navigate')?.(event as never);
    expect(event.preventDefault).toHaveBeenCalled();
    const unload = { preventDefault: vi.fn(), returnValue: undefined as string | undefined };
    listeners.get('beforeunload')?.(unload as never);
    expect(unload.preventDefault).toHaveBeenCalled();
  });
});
