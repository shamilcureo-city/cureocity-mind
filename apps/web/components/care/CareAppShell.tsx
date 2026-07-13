'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SafetyStrip, type CareResource } from './SafetyStrip';

/**
 * The signed-in /care web shell (the desktop "web view").
 *
 * The Care product is mobile-first — the voice session and onboarding
 * are full-bleed and live OUTSIDE this shell. Everything else (home,
 * progress, plan, settings, the post-session report) renders inside it:
 *
 *   - desktop (`md:`) — a persistent left sidebar (Home / Progress /
 *     Plan / Settings), a crisis note + sign-out in its footer, and a
 *     wide content column offset by the sidebar.
 *   - mobile — a sticky top bar with the same nav as compact icons +
 *     sign-out. No bottom tab bar: the SafetyStrip owns the bottom edge
 *     (a hard safety layer), so nav goes on top to avoid a collision.
 *
 * The SafetyStrip is centralised here so every shell'd screen keeps its
 * crisis chrome (§2 layer 1); it is offset by the sidebar on desktop.
 * Sign-out is a POST form (never a GET link — prefetchers would clear
 * the session cookie), pointed at the care-scoped signout route.
 */
interface NavItem {
  href: string;
  label: string;
  icon: IconKind;
}

const NAV: NavItem[] = [
  { href: '/care/home', label: 'Home', icon: 'home' },
  { href: '/care/progress', label: 'Progress', icon: 'progress' },
  { href: '/care/plan-tier', label: 'Plan', icon: 'plan' },
  { href: '/care/settings', label: 'Settings', icon: 'settings' },
];

export function CareAppShell({
  children,
  resources,
  personaName,
}: {
  children: ReactNode;
  resources: CareResource[];
  personaName?: string;
}) {
  const path = usePathname() ?? '/care/home';
  const isActive = (href: string): boolean => path === href || path.startsWith(`${href}/`);

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] md:flex">
        <div className="px-6 py-6">
          <Link href="/care/home" className="inline-flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent)] text-white">
              ☾
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">Cureocity Care</span>
          </Link>
        </div>

        <nav className="px-3" aria-label="Primary">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 ${
                      active
                        ? 'bg-white font-medium text-[var(--color-ink)] shadow-sm'
                        : 'text-[var(--color-ink-2)] hover:bg-white/60 hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Icon kind={item.icon} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-auto px-4 pb-6">
          {personaName ? (
            <div className="rounded-2xl border border-[var(--color-line)] bg-white p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
                Your therapist
              </p>
              <p className="mt-1 text-sm font-medium">{personaName}</p>
            </div>
          ) : null}
          <SignOut className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-[var(--color-ink-2)] hover:bg-white/60 hover:text-[var(--color-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2">
            <Icon kind="signout" />
            Sign out
          </SignOut>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-line-soft)] bg-[var(--color-bg)]/95 px-4 backdrop-blur md:hidden">
        <Link href="/care/home" className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--color-accent)] text-sm text-white">
            ☾
          </span>
          <span className="font-serif text-base font-semibold tracking-tight">Care</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Primary">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`grid h-9 w-9 place-items-center rounded-lg transition-colors ${
                  active
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-3)] hover:text-[var(--color-ink)]'
                }`}
              >
                <Icon kind={item.icon} />
              </Link>
            );
          })}
          <SignOut
            aria-label="Sign out"
            className="grid h-9 w-9 place-items-center rounded-lg text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
          >
            <Icon kind="signout" />
          </SignOut>
        </nav>
      </header>

      {/* Content — offset by the sidebar on desktop. */}
      <div className="md:pl-64">{children}</div>

      <SafetyStrip resources={resources} />
    </div>
  );
}

/** POST-only sign-out (a GET link would be prefetched and clear the cookie). */
function SignOut({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <form method="POST" action="/api/v1/care/auth/signout">
      <button type="submit" className={className} aria-label={ariaLabel}>
        {children}
      </button>
    </form>
  );
}

type IconKind = 'home' | 'progress' | 'plan' | 'settings' | 'signout';

function Icon({ kind }: { kind: IconKind }) {
  const paths: Record<IconKind, string> = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    progress: 'M4 20h16M7 20v-6M12 20V8M17 20v-10',
    plan: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    settings:
      'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    signout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  };
  return (
    <svg
      aria-hidden
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
