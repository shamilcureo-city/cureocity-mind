'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Sprint 61 — a calm first-run welcome.
 *
 * Shown once, the first time a therapist opens the app, to set
 * expectations gently: what this is, how a session flows, who's in
 * charge, and where help lives. Dismissal is remembered in localStorage
 * (the fast-path); a durable per-therapist `hasSeenWelcome` flag + a
 * `WELCOME_DISMISSED` audit is the documented follow-up.
 *
 * Renders nothing on the server / until mounted, so there's no flash and
 * no hydration mismatch.
 */

const STORAGE_KEY = 'cm.welcome.v1';

const POINTS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '🎙️',
    title: 'Record your session',
    body: 'Press record during the session. Your audio is saved safely as you go.',
  },
  {
    emoji: '📝',
    title: 'The app writes the note',
    body: 'When you finish, it turns the conversation into a clear, written note — for you to check.',
  },
  {
    emoji: '✓',
    title: 'You stay in charge',
    body: 'Read it, change anything, and approve. Nothing is saved as final until you say so.',
  },
  {
    emoji: '💡',
    title: 'Help is always one tap away',
    body: 'See a word you don’t know? Tap “What’s this?”, or the “?” button in the corner.',
  },
];

export function WelcomeOverlay() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== 'seen') setShow(true);
    } catch {
      // localStorage unavailable (private mode etc.) — just don't show.
    }
  }, []);

  function dismiss(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'seen');
    } catch {
      // ignore — worst case it shows again next time.
    }
    setShow(false);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4">
      <div className="w-[min(34rem,100%)] rounded-3xl border border-[var(--color-line)] bg-white p-7 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Welcome
        </p>
        <h2 className="mt-2 font-serif text-2xl">A calmer way to keep your notes</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Here’s the whole idea in four lines. It’s simpler than it looks — and you’re always in
          control.
        </p>

        <ul className="mt-5 space-y-3">
          {POINTS.map((p) => (
            <li key={p.title} className="flex items-start gap-3">
              <span aria-hidden className="text-xl leading-none">
                {p.emoji}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--color-ink)]">{p.title}</p>
                <p className="text-sm text-[var(--color-ink-2)]">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Let’s start
          </button>
          <Link
            href="/app/learn"
            onClick={dismiss}
            className="text-sm font-medium text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
          >
            Show me around first →
          </Link>
        </div>
      </div>
    </div>
  );
}
