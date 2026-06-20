'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cureocity:privacy-mode';

/**
 * Sprint 57 — Privacy mode.
 *
 * Blurs client-identifying text (anything tagged `.privacy-blur`) so the
 * therapist can screen-share, work at a clinic desk, or record a demo
 * without exposing names. Toggles a `privacy-on` class on <body>; the blur
 * itself is a CSS rule in globals.css. State persists per-device in
 * localStorage and is restored on mount.
 *
 * Server components render the (un-blurred) names with `className="privacy-blur"`;
 * the body class decides whether the blur applies, so there's no flash of
 * cleartext beyond the first paint (and we restore the class as early as the
 * effect runs).
 */
export function PrivacyModeToggle() {
  const [on, setOn] = useState(false);

  // Restore persisted state on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) === '1';
    setOn(stored);
    document.body.classList.toggle('privacy-on', stored);
  }, []);

  function toggle() {
    setOn((prev) => {
      const next = !prev;
      document.body.classList.toggle('privacy-on', next);
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
        on
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'border-[var(--color-line)] bg-white text-[var(--color-ink-2)] hover:border-[var(--color-ink)]'
      }`}
    >
      <EyeGlyph off={on} />
      {on ? 'Privacy on' : 'Privacy mode'}
    </button>
  );
}

function EyeGlyph({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {off ? (
        <>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.12 9.12 0 0 0 5.39-1.61" />
          <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88M1 1l22 22" />
        </>
      ) : (
        <>
          <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}
