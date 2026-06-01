'use client';

import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { getFirebaseAuth, isFirebaseClientConfigured } from './firebase-client';

/**
 * Wait-for-auth hook. Returns:
 *   { status: 'loading' }     — Firebase has not resolved yet
 *   { status: 'signed-out' }  — no user
 *   { status: 'signed-in', user }
 *
 * The patient PWA gates the home + mood + journal screens behind
 * `status === 'signed-in'`. Authentication itself happens in the QR
 * claim flow at /claim/[token]; this hook only observes.
 *
 * Demo bypass: when NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY is unset,
 * Firebase is unavailable, so the hook returns a stub signed-in user
 * whose getIdToken() returns "dev-bypass". The server-side
 * resolveClient (apps/web/lib/auth-server.ts) ignores Bearer tokens
 * when Firebase Admin is also unset and resolves the seeded demo
 * client by clientFirebaseUid. Both bypasses auto-disengage when real
 * Firebase env vars land.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User };

function demoBypassUser(): User {
  return {
    uid: 'dev-client-firebase-uid-arjun',
    email: 'arjun.rao@example.in',
    phoneNumber: '+919812345678',
    displayName: 'Arjun Rao',
    getIdToken: async () => 'dev-bypass',
    getIdTokenResult: async () => ({ token: 'dev-bypass' }) as never,
  } as unknown as User;
}

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    if (!isFirebaseClientConfigured()) {
      setState({ status: 'signed-in', user: demoBypassUser() });
      return;
    }
    let cancelled = false;
    try {
      const unsub = onAuthStateChanged(getFirebaseAuth(), (user) => {
        if (cancelled) return;
        setState(user ? { status: 'signed-in', user } : { status: 'signed-out' });
      });
      return () => {
        cancelled = true;
        unsub();
      };
    } catch {
      setState({ status: 'signed-out' });
      return () => {
        cancelled = true;
      };
    }
  }, []);

  return state;
}

export async function getIdToken(user: User): Promise<string> {
  return user.getIdToken();
}
