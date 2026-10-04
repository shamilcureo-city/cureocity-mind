'use client';

import { onAuthStateChanged, signOut } from 'firebase/auth';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase-therapist';
import { createSessionBoundFetch } from '@/lib/session-bound-fetch';
import { recoverPractitionerSession } from '@/lib/session-recovery';

type SessionProblem = 'SESSION_IDENTITY_MISMATCH' | 'SESSION_REAUTH_REQUIRED';

/**
 * Bind browser actions to the verified account that rendered this page.
 * Children mount only after the interceptor and Firebase readiness check:
 * their initial effects cannot race authentication hydration. Subsequent
 * mismatches pause requests without unmounting an already-open draft.
 */
interface Props {
  expectedUid: string | null;
  children: ReactNode;
}

export function AuthedFetchProvider({ expectedUid, children }: Props) {
  return (
    <SessionBoundContent
      key={expectedUid === null ? 'bypass' : `identity:${expectedUid}`}
      expectedUid={expectedUid}
    >
      {children}
    </SessionBoundContent>
  );
}

function SessionBoundContent({ expectedUid, children }: Props) {
  const [ready, setReady] = useState(expectedUid === null);
  const [problem, setProblem] = useState<SessionProblem | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const originalFetch = useRef<typeof fetch | null>(null);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Only explicit non-production auth bypass supplies null.
    if (expectedUid === null) return;
    let mounted = true;
    const original = window.fetch;
    originalFetch.current = original.bind(window);
    const guard = createSessionBoundFetch({
      fetch: originalFetch.current,
      origin: window.location.origin,
      expectedUid,
      getUser: async () => {
        if (!isFirebaseConfigured()) return null;
        const auth = getFirebaseAuth();
        await auth.authStateReady();
        return auth.currentUser;
      },
    });
    window.fetch = guard.fetch;
    const unsubscribeProblem = guard.subscribe(() => {
      if (mounted) setProblem(guard.getProblem());
    });
    void guard.checkIdentity().then(() => {
      if (mounted && !guard.getProblem()) setReady(true);
    });
    let unsubscribeAuth = () => {};
    if (isFirebaseConfigured()) {
      try {
        unsubscribeAuth = onAuthStateChanged(getFirebaseAuth(), () => {
          void guard.checkIdentity();
        });
      } catch {
        // checkIdentity handles unavailable Firebase without falling back
        // to a different identity.
      }
    }
    return () => {
      mounted = false;
      unsubscribeProblem();
      unsubscribeAuth();
      if (window.fetch === guard.fetch) window.fetch = original;
      originalFetch.current = null;
    };
  }, [expectedUid]);

  useEffect(() => {
    if (problem) notice.current?.focus();
  }, [problem]);

  async function recover() {
    if (recovering || !originalFetch.current) return;
    setRecovering(true);
    setRecoveryError(null);
    try {
      await recoverPractitionerSession({
        fetch: originalFetch.current,
        signOut: async () => {
          if (isFirebaseConfigured()) await signOut(getFirebaseAuth());
        },
        navigate: (url) => window.location.assign(url),
      });
    } catch {
      setRecoveryError('Could not finish signing out. Check your connection and try again.');
      setRecovering(false);
    }
  }

  return (
    <>
      {problem && (
        <div
          ref={notice}
          role="alert"
          tabIndex={-1}
          className="fixed inset-x-3 top-3 z-[100] mx-auto max-w-2xl rounded-2xl border border-[var(--color-line)] bg-white p-5 text-[var(--color-ink)] shadow-xl focus:outline-none"
        >
          <h2 className="font-serif text-2xl">Sign in again to continue</h2>
          <p className="mt-2 text-sm">
            {problem === 'SESSION_IDENTITY_MISMATCH'
              ? 'Your saved sign-ins do not match. Actions are paused so this page cannot use a different account.'
              : 'We could not verify your current sign-in. Actions are paused until you sign in again.'}
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            No failed action will be retried automatically. Copy any unsaved work before continuing;
            signing in again leaves this page and discards unsaved changes.
          </p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            A request already sent may have completed. Check your last action after signing in
            before trying it again.
          </p>
          {recoveryError && (
            <p className="mt-2 text-sm text-[var(--color-warn)]">{recoveryError}</p>
          )}
          <button
            type="button"
            disabled={recovering}
            onClick={() => void recover()}
            className="mt-4 min-h-11 rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            {recovering ? 'Signing out…' : 'Sign in again'}
          </button>
        </div>
      )}
      {ready ? (
        children
      ) : !problem ? (
        <div role="status" className="p-8 text-sm text-[var(--color-ink-2)]">
          Checking your sign-in…
        </div>
      ) : null}
    </>
  );
}
