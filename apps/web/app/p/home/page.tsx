'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import type { ClientCareHome } from '@cureocity/contracts';
import { getFirebaseAuth } from '@/lib/firebase-client';
import { createClientCareHomeAuthLifecycle } from '@/lib/client-care-home-auth-lifecycle';
import ClientPhoneSignIn from '@/components/portal/ClientPhoneSignIn';

export default function ClientCareHomePage() {
  const [home, setHome] = useState<ClientCareHome | null>(null);
  const [message, setMessage] = useState('Opening your care…');
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => {
    const lifecycle = createClientCareHomeAuthLifecycle<ClientCareHome>({
      clearHome: () => setHome(null),
      applyHome: setHome,
      applyError: () =>
        setMessage('Your care page is not available. Ask your therapist for care access.'),
    });
    const unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (!user) {
        lifecycle.transition(null);
        setSignedOut(true);
        setMessage('Sign in with the phone number you used to claim care access.');
        return;
      }

      setSignedOut(false);
      setMessage('Opening your care…');
      lifecycle.transition(async (signal) => {
        const token = await user.getIdToken();
        if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');

        const refreshShareId = new URLSearchParams(window.location.search).get('refresh');
        if (refreshShareId) {
          const requested = await fetch('/api/v1/p/home', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ shareId: refreshShareId }),
            signal,
          });
          if (!requested.ok) throw new Error();
          if (signal.aborted) throw new DOMException('Request aborted', 'AbortError');
          setMessage('A fresh-link request was sent to your care team.');
          window.history.replaceState(null, '', '/p/home');
        }
        const response = await fetch('/api/v1/p/home', {
          headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error();
        return response.json() as Promise<ClientCareHome>;
      });
    });

    return () => {
      unsubscribe();
      lifecycle.dispose();
    };
  }, []);
  if (!home)
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="font-serif text-3xl">Your care</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">{message}</p>
        {signedOut && <ClientPhoneSignIn />}
      </main>
    );
  const labels: Record<string, string> = {
    WHAT_TO_DO_NEXT: 'What to do next',
    UPCOMING_SESSION: 'Upcoming session',
    HOMEWORK_CHECKINS: 'Homework/check-ins',
    GOALS_PROGRESS: 'Goals/progress',
    THERAPIST_RESOURCES: 'Therapist resources',
    HISTORY: 'History',
  };
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-serif text-3xl">Your care</h1>
      <div className="mt-8 space-y-8">
        {home.sections.map((section) => (
          <section key={section.kind}>
            <h2 className="font-serif text-xl">{labels[section.kind]}</h2>
            {section.items.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-3)]">Nothing here right now.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {section.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-xl border border-[var(--color-line-soft)] p-4"
                  >
                    <p className="font-medium">{item.title}</p>
                    {item.detail && (
                      <p className="mt-1 text-sm text-[var(--color-ink-2)]">{item.detail}</p>
                    )}
                    {item.href && (
                      <a
                        className="mt-2 inline-block text-sm text-[var(--color-accent)]"
                        href={item.href}
                      >
                        Open →
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
