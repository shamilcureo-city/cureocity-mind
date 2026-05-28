'use client';

import { onAuthStateChanged, type User } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { getFirebaseAuth } from './firebase-client';

/**
 * Wait-for-auth hook. Returns:
 *   { status: 'loading' }     — Firebase has not resolved yet
 *   { status: 'signed-out' }  — no user
 *   { status: 'signed-in', user }
 *
 * The patient PWA gates the home + mood + journal screens behind
 * `status === 'signed-in'`. Authentication itself happens in the QR
 * claim flow at /claim/[token]; this hook only observes.
 */
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: User };

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
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
      // getFirebaseAuth throws when NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY is
      // unset — common in CI where env vars aren't configured. Surface as
      // signed-out so screens render their "log in" fallback instead of
      // hanging on "loading".
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
