'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type PractitionerVertical } from '@cureocity/contracts';
import { Glyph } from '@/components/app/Sidebar';
import { useModalA11y } from '@/lib/use-modal-a11y';

// Sprint 45 — Today is the morning landing screen on phones too. Mobile
// is capped at 5 grid cols. Sprint TS3 kept the bar to the primary spine;
// AUD2 — the fifth slot is now "More": before it, Settings, My practice
// and SIGN OUT were unreachable on the exact device the pilot is
// optimised for (the sidebar is hidden md:flex and no drawer existed).
const ITEMS: {
  href: string;
  label: string;
  icon: 'today' | 'record' | 'clients' | 'search' | 'templates' | 'clinic' | 'insights' | 'cog';
}[] = [
  { href: '/app/today', label: 'Today', icon: 'today' },
  { href: '/app', label: 'Record', icon: 'record' },
  { href: '/app/clients', label: 'Clients', icon: 'clients' },
  { href: '/app/search', label: 'Search', icon: 'search' },
];

// AUD2 — everything that used to be desktop-only, one tap away.
const MORE_ITEMS: {
  href: string;
  label: string;
  icon: 'templates' | 'dashboard' | 'assistant' | 'me' | 'learn' | 'cog' | 'help';
}[] = [
  { href: '/app/templates', label: 'Templates', icon: 'templates' },
  { href: '/app/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/app/practice-assistant', label: 'Assistant', icon: 'assistant' },
  { href: '/app/me', label: 'My practice', icon: 'me' },
  { href: '/app/learn', label: 'Learn', icon: 'learn' },
  { href: '/app/settings', label: 'Settings', icon: 'cog' },
];

// Sprint DV2 — doctor bottom bar: the patient roster + settings. See
// docs/DOCTOR_VERTICAL.md. Sprint DS7 — Clinic (the OPD queue) leads.
const DOCTOR_ITEMS: typeof ITEMS = [
  { href: '/app/clinic', label: 'Clinic', icon: 'clinic' },
  { href: '/app/patients', label: 'Patients', icon: 'clients' },
  { href: '/app/insights', label: 'Insights', icon: 'insights' },
  { href: '/app/settings', label: 'Settings', icon: 'cog' },
];

/**
 * Bottom tab bar for phones. The desktop sidebar is `hidden md:flex`,
 * which previously left small screens with NO navigation at all —
 * Indian solo practitioners are phone-first, so this is the primary
 * nav for a large slice of the pilot. Pages get bottom padding from
 * the app layout so content never hides behind the bar.
 *
 * AUD2 — therapists get a fifth "More" tab that opens a bottom sheet
 * with the secondary destinations + a POST sign-out (never a GET link —
 * see docs/AUTH_SESSION.md for the prefetch incident).
 */
export function MobileNav({ vertical = 'THERAPIST' }: { vertical?: PractitionerVertical }) {
  const path = usePathname() ?? '/app';
  const [moreOpen, setMoreOpen] = useState(false);
  const isDoctor = vertical === 'DOCTOR';
  const items = isDoctor ? DOCTOR_ITEMS : ITEMS;
  const cols = isDoctor ? items.length : items.length + 1;

  // Close the sheet on navigation; NEXT7 — the shared hook adds Escape,
  // focus trapping and focus restore.
  useEffect(() => setMoreOpen(false), [path]);
  const sheetRef = useRef<HTMLDivElement>(null);
  useModalA11y(moreOpen, sheetRef, () => setMoreOpen(false));

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-[rgba(15,27,42,0.35)]"
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label="More"
            className="absolute inset-x-0 bottom-14 rounded-t-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-3 pb-4 shadow-2xl"
          >
            <ul className="grid grid-cols-3 gap-1.5">
              {MORE_ITEMS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
                  >
                    <Glyph kind={item.icon} />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <form
              method="POST"
              action="/api/v1/auth/signout"
              className="mt-2 border-t border-[var(--color-line-soft)] pt-2"
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl px-2 py-3 text-sm font-medium text-[var(--color-ink-2)] hover:bg-[var(--color-surface-soft)]"
              >
                <Glyph kind="signout" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line-soft)] bg-white/80 backdrop-blur-xl md:hidden"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {items.map((item) => {
            const active = item.href === '/app' ? path === '/app' : path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-1 px-1 py-2.5 text-xs ${
                    active ? 'font-medium text-[var(--color-accent)]' : 'text-[var(--color-ink-2)]'
                  }`}
                >
                  <Glyph kind={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
          {!isDoctor && (
            <li>
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                className={`flex w-full flex-col items-center gap-1 px-1 py-2.5 text-xs ${
                  moreOpen ? 'font-medium text-[var(--color-accent)]' : 'text-[var(--color-ink-2)]'
                }`}
              >
                <Glyph kind="dashboard" />
                More
              </button>
            </li>
          )}
        </ul>
      </nav>
    </>
  );
}
