export type SessionIdentityProblem = 'SESSION_IDENTITY_MISMATCH' | 'SESSION_REAUTH_REQUIRED';

export interface SessionBoundUser {
  uid: string;
  getIdToken: () => Promise<string>;
}

interface SessionBoundFetchOptions {
  fetch: typeof fetch;
  origin: string;
  expectedUid: string;
  /** Resolves only after the Firebase auth instance has finished initialising. */
  getUser: () => Promise<SessionBoundUser | null>;
}

const ASSERTION_HEADER = 'x-cureocity-session-uid';
const IDENTITY_WAIT_TIMEOUT_MS = 10_000;
const outsidePractitionerSession = ['/api/v1/care', '/api/v1/public', '/api/v1/p'];

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
}

/** Bound auth waits without attempting to cancel shared Firebase readiness. */
function awaitWithAbort<T>(
  work: () => Promise<T>,
  signal: AbortSignal | null | undefined,
): Promise<T> {
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', aborted);
      settle();
    };
    const aborted = () => {
      finish(() => reject(new DOMException('The request was aborted.', 'AbortError')));
    };
    const timeout = setTimeout(
      () => finish(() => reject(new Error('Session identity check timed out.'))),
      IDENTITY_WAIT_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', aborted, { once: true });
    // Attach both handlers even if cancellation wins, so late rejections are handled.
    Promise.resolve()
      .then(() => {
        throwIfAborted(signal);
        return work();
      })
      .then(
        (value) => {
          if (signal?.aborted) aborted();
          else finish(() => resolve(value));
        },
        (reason: unknown) => {
          if (signal?.aborted) aborted();
          else finish(() => reject(reason));
        },
      );
  });
}

/**
 * Binds practitioner requests to the server-rendered page identity. It cannot
 * choose an account or grant access: the server still verifies the cookie/token.
 * Recovery requires replacing this instance after a fresh authenticated page load.
 */
export function createSessionBoundFetch(options: SessionBoundFetchOptions): {
  fetch: typeof fetch;
  checkIdentity(): Promise<void>;
  getProblem(): SessionIdentityProblem | null;
  subscribe(listener: () => void): () => void;
} {
  const origin = new URL(options.origin).origin;
  const expectedUid = options.expectedUid;
  if (!expectedUid) throw new Error('A page session identity is required.');
  let problem: SessionIdentityProblem | null = null;
  const listeners = new Set<() => void>();

  function setProblem(next: SessionIdentityProblem) {
    if (problem) return;
    problem = next;
    for (const listener of listeners) {
      // An observer must never make a failed identity check fall back to fetch.
      try {
        listener();
      } catch {
        // The sticky problem remains authoritative even if an observer fails.
      }
    }
  }

  function problemResponse(): Response {
    return Response.json(
      {
        code: problem ?? 'SESSION_REAUTH_REQUIRED',
        error:
          problem === 'SESSION_IDENTITY_MISMATCH'
            ? 'Your sign-in changed. Sign in again to continue with one account.'
            : 'Your session needs to be verified. Sign in again to continue.',
      },
      { status: 401, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }

  function isGuarded(input: RequestInfo | URL): boolean {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), origin);
    } catch {
      // Leave malformed/non-HTTP requests to the supplied fetch implementation.
      return false;
    }
    if (url.origin !== origin) return false;
    const path = url.pathname;
    if (path !== '/api/v1' && !path.startsWith('/api/v1/')) return false;
    if (
      outsidePractitionerSession.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
    )
      return false;
    return !['/api/v1/auth/session', '/api/v1/auth/signout'].some(
      (authPath) => path === authPath || path === `${authPath}/`,
    );
  }

  async function checkIdentity(): Promise<void> {
    if (problem) return;
    try {
      const user = await awaitWithAbort(options.getUser, undefined);
      if (user && user.uid !== expectedUid) setProblem('SESSION_IDENTITY_MISMATCH');
    } catch {
      setProblem('SESSION_REAUTH_REQUIRED');
    }
  }

  const boundFetch: typeof fetch = async (input, init) => {
    if (!isGuarded(input)) return options.fetch(input, init);
    const original = input instanceof Request ? input : null;
    const signal = init?.signal !== undefined ? init.signal : original?.signal;
    throwIfAborted(signal);
    if (problem) return problemResponse();

    // RequestInit headers replace Request headers, matching native fetch semantics.
    const headers = new Headers(init?.headers ?? original?.headers);
    try {
      const user = await awaitWithAbort(options.getUser, signal);
      throwIfAborted(signal);
      if (problem) return problemResponse();
      if (user && user.uid !== expectedUid) {
        setProblem('SESSION_IDENTITY_MISMATCH');
        return problemResponse();
      }

      if (user && !headers.has('Authorization')) {
        const token = await awaitWithAbort(() => user.getIdToken(), signal);
        throwIfAborted(signal);
        if (problem) return problemResponse();
        const current = await awaitWithAbort(options.getUser, signal);
        throwIfAborted(signal);
        if (problem) return problemResponse();
        if (current && current.uid !== expectedUid) {
          setProblem('SESSION_IDENTITY_MISMATCH');
          return problemResponse();
        }
        if (!current || !token.trim()) {
          setProblem('SESSION_REAUTH_REQUIRED');
          return problemResponse();
        }
        headers.set('Authorization', `Bearer ${token}`);
      }
      // A null Firebase user can still have a valid server session cookie. This
      // assertion lets the server reject a stale page paired with a newer cookie.
      headers.set(ASSERTION_HEADER, expectedUid);
    } catch {
      throwIfAborted(signal);
      setProblem('SESSION_REAUTH_REQUIRED');
      return problemResponse();
    }

    throwIfAborted(signal);
    if (problem) return problemResponse();
    // Never retry/replay: this may be a non-idempotent clinical or billing write.
    // The UID assertion is a custom header. Unlike Authorization, it may survive
    // cross-origin redirects, so guarded JSON APIs must never follow redirects.
    const response = await options.fetch(input, { ...init, headers, redirect: 'error' });
    throwIfAborted(signal);
    if (problem) return problemResponse();
    if (response.status === 401) {
      let code: unknown;
      try {
        const body: unknown = await awaitWithAbort(() => response.clone().json(), signal);
        if (body && typeof body === 'object' && 'code' in body) code = body.code;
      } catch {
        throwIfAborted(signal);
      }
      setProblem(code === 'SESSION_IDENTITY_MISMATCH' ? code : 'SESSION_REAUTH_REQUIRED');
      return response;
    }
    return response;
  };

  return {
    fetch: boundFetch,
    checkIdentity,
    getProblem: () => problem,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
