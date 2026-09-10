import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postSignNote, type SignNoteBody } from './sign-note';

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof fetch>(),
  authenticate: vi.fn(),
}));
vi.mock('@/lib/webauthn', () => ({ authenticateWithChallenge: mocks.authenticate }));

const body: SignNoteBody = {
  note: { version: 'V1', subjective: 'Fictional clinical note.' },
  draftContent: { version: 'V1', subjective: 'Fictional clinical note.' },
  edits: [],
  signedAt: '2026-09-10T12:00:00.000Z',
  rxPad: null,
};
const assertion = { credentialId: 'fictional-credential', signature: 'fictional-signature' };

function pendingUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  expect(signal).toBeInstanceOf(AbortSignal);
  return new Promise((_, reject) => {
    signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
  });
}
function controlledTimeouts() {
  const controllers: AbortController[] = [];
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  return { controllers, timeout };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', mocks.request);
  mocks.authenticate.mockResolvedValue(assertion);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('sign-note per-request deadline', () => {
  it('leaves the existing Scribe request and response behavior unchanged without options', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const response = Response.json({ id: 'fictional-note' }, { status: 201 });
    mocks.request.mockResolvedValueOnce(response);

    expect(await postSignNote('fictional-session', body)).toBe(response);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.request.mock.calls[0];
    expect(url).toBe('/api/v1/sessions/fictional-session/sign');
    expect(init).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: expect.any(String),
    });
    expect(JSON.parse(init!.body as string)).toMatchObject({
      note: body.note,
      edits: body.edits,
      signedAt: body.signedAt,
      payloadHashHex: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(timeout).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('preserves the existing Scribe passkey retry without introducing a signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const response = Response.json({ id: 'fictional-note' }, { status: 201 });
    mocks.request
      .mockResolvedValueOnce(Response.json({ error: 'Assertion required' }, { status: 401 }))
      .mockResolvedValueOnce(response);

    expect(await postSignNote('fictional-session', body)).toBe(response);
    const first = JSON.parse(mocks.request.mock.calls[0][1]!.body as string);
    const second = JSON.parse(mocks.request.mock.calls[1][1]!.body as string);
    expect(second).toEqual({ ...first, assertion });
    expect(mocks.authenticate).toHaveBeenCalledExactlyOnceWith(first.payload);
    expect(mocks.request.mock.calls.every(([, init]) => !('signal' in init!))).toBe(true);
    expect(timeout).not.toHaveBeenCalled();
  });

  it('gives the post-passkey HTTP attempt a fresh deadline without timing out the prompt', async () => {
    const { controllers, timeout } = controlledTimeouts();
    let finishPasskey!: (value: typeof assertion) => void;
    mocks.authenticate.mockImplementationOnce(
      () => new Promise((resolve) => (finishPasskey = resolve)),
    );
    const response = Response.json({ id: 'fictional-note' }, { status: 201 });
    mocks.request
      .mockResolvedValueOnce(Response.json({ error: 'Assertion required' }, { status: 401 }))
      .mockResolvedValueOnce(response);

    let settled = false;
    const signing = postSignNote('fictional-session', body, { requestTimeoutMs: 20_000 });
    void signing.then(() => (settled = true));
    await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledTimes(1));
    controllers[0].abort(new DOMException('Request deadline elapsed', 'TimeoutError'));
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(20_000);

    finishPasskey(assertion);
    expect(await signing).toBe(response);
    expect(timeout.mock.calls).toEqual([[20_000], [20_000]]);
    const firstSignal = mocks.request.mock.calls[0][1]!.signal;
    const secondSignal = mocks.request.mock.calls[1][1]!.signal;
    expect(firstSignal).toBe(controllers[0].signal);
    expect(secondSignal).toBe(controllers[1].signal);
    expect(firstSignal).not.toBe(secondSignal);
    expect(secondSignal!.aborted).toBe(false);
  });

  it.each([1, 2])(
    'propagates attempt %i timeout without automatically posting again',
    async (attempt) => {
      const { controllers } = controlledTimeouts();
      if (attempt === 2)
        mocks.request.mockResolvedValueOnce(
          Response.json({ error: 'Assertion required' }, { status: 401 }),
        );
      mocks.request.mockImplementationOnce((_, init) => pendingUntilAbort(init?.signal));
      const signing = postSignNote('fictional-session', body, { requestTimeoutMs: 20_000 });
      const rejected = expect(signing).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(attempt));
      controllers[attempt - 1].abort(new DOMException('Request deadline elapsed', 'TimeoutError'));

      await rejected;
      expect(mocks.request).toHaveBeenCalledTimes(attempt);
      expect(mocks.authenticate).toHaveBeenCalledTimes(attempt - 1);
    },
  );
});
