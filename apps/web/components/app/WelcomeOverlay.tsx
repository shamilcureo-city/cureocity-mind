'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Sprint 61 — a calm first-run welcome.
 *
 * Shown once, the first time a therapist opens the app, to set
 * expectations gently: what this is, how a session flows, who's in
 * charge, and where help lives.
 *
 * Dismissal is durable: `serverSeen` comes from the per-therapist
 * `hasSeenWelcome` column, and dismissing POSTs to record it (audited
 * `WELCOME_DISMISSED`) so it stays dismissed on every device. localStorage
 * is kept only as an instant client-side fast-path (no flash before the
 * server flag is known, and it still suppresses the overlay if the POST
 * fails).
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

export function WelcomeOverlay({ serverSeen = false }: { serverSeen?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Durably dismissed on the account — never show, regardless of device.
    if (serverSeen) return;
    try {
      if (window.localStorage.getItem(STORAGE_KEY) !== 'seen') setShow(true);
    } catch {
      // localStorage unavailable (private mode etc.) — just don't show.
    }
  }, [serverSeen]);

  function dismiss(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, 'seen');
    } catch {
      // ignore — the durable POST below is the source of truth.
    }
    setShow(false);
    // Persist durably so it stays dismissed on every other device too.
    // Fire-and-forget; AuthedFetchProvider attaches the bearer token.
    void fetch('/api/v1/psychologists/me/welcome', { method: 'POST' }).catch(() => {
      // best-effort — the localStorage flag still suppresses it on this device.
    });
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
