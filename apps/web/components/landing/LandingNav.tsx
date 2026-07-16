'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Landing v9.3 — the sticky glass pill header + mobile hamburger menu.
 * Anchor links scroll the landing sections; Sign in / Start free go to /login.
 */

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#live', label: 'During the session' },
  { href: '#docs', label: 'The documents' },
  { href: '#outcomes', label: 'Outcomes' },
  { href: '#privacy', label: 'Your data' },
];

export function LandingWordmark() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 12h3l2.5-6 3 12 3-9 2 3H21"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="serif" style={{ fontSize: 18, fontWeight: 640 }}>
        Cureocity <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>Mind</em>
      </span>
    </span>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <nav className="nav">
      <div className="nav-in">
        <Link
          href="/"
          aria-label="Cureocity Mind home"
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <LandingWordmark />
        </Link>
        <span className="navlinks">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href}>
              {l.label}
            </a>
          ))}
        </span>
        <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link
            href="/login"
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink2)', textDecoration: 'none' }}
          >
            Sign in
          </Link>
          <Link href="/login" className="btn primary sm" style={{ textDecoration: 'none' }}>
            Start free
          </Link>
          <button
            className="burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
      </div>
      <div ref={menuRef} className={`mmenu${open ? ' open' : ''}`}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a href="/for-doctors" onClick={() => setOpen(false)}>
          For doctors — Cureocity Scribe
        </a>
        <div className="mm-cta">
          <Link href="/login" className="btn primary" style={{ flex: 1, textDecoration: 'none' }}>
            Start free
          </Link>
          <Link href="/login" className="btn secondary" style={{ flex: 1, textDecoration: 'none' }}>
            Sign in
          </Link>
        </div>
      </div>
    </nav>
  );
}
