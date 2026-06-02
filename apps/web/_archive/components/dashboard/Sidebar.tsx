'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Wordmark } from '../layout/Wordmark';

const ITEMS = [
  { href: '/dashboard', label: 'Overview', icon: 'home' },
  { href: '/dashboard/clients', label: 'Clients', icon: 'users' },
  { href: '/dashboard/bookings', label: 'Booking requests', icon: 'inbox' },
  { href: '/dashboard/intakes', label: 'New intakes', icon: 'spark' },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] md:flex md:flex-col">
      <div className="px-6 py-6">
        <Wordmark />
      </div>
      <nav className="px-3">
        <ul className="space-y-1">
          {ITEMS.map((it) => {
            const active =
              it.href === '/dashboard' ? path === '/dashboard' : path?.startsWith(it.href);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? 'bg-white font-medium text-[var(--color-ink)] shadow-sm'
                      : 'text-[var(--color-ink-2)] hover:bg-white/60 hover:text-[var(--color-ink)]'
                  }`}
                >
                  <Glyph kind={it.icon} />
                  {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto px-6 py-6">
        <Link
          href="/"
          className="text-xs text-[var(--color-ink-3)] hover:text-[var(--color-ink)]"
        >
          ← Back to home
        </Link>
      </div>
    </aside>
  );
}

function Glyph({ kind }: { kind: string }) {
  const path =
    kind === 'home'
      ? 'M3 11l9-8 9 8M5 10v10h14V10'
      : kind === 'users'
        ? 'M16 14a4 4 0 1 0-8 0M3 21v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1'
        : kind === 'inbox'
          ? 'M3 13h6l1 2h4l1-2h6M5 5h14l2 8v6H3v-6l2-8z'
          : 'M12 3v3M12 18v3M5 12H2M22 12h-3M19 5l-2 2M7 17l-2 2M19 19l-2-2M7 7 5 5';
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
      <path d={path} />
    </svg>
  );
}
