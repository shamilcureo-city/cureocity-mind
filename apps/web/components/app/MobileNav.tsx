'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Glyph } from '@/components/app/Sidebar';

const ITEMS: { href: string; label: string; icon: 'record' | 'clients' | 'klara' | 'me' | 'cog' }[] =
  [
    { href: '/app', label: 'Record', icon: 'record' },
    { href: '/app/clients', label: 'Clients', icon: 'clients' },
    { href: '/app/klara', label: 'Klara', icon: 'klara' },
    { href: '/app/me', label: 'Practice', icon: 'me' },
    { href: '/app/settings', label: 'Settings', icon: 'cog' },
  ];

/**
 * Bottom tab bar for phones. The desktop sidebar is `hidden md:flex`,
 * which previously left small screens with NO navigation at all —
 * Indian solo practitioners are phone-first, so this is the primary
 * nav for a large slice of the pilot. Pages get bottom padding from
 * the app layout so content never hides behind the bar.
 */
export function MobileNav() {
  const path = usePathname() ?? '/app';
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]/95 backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.href === '/app' ? path === '/app' : path.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-1 px-1 py-2.5 text-[10px] ${
                  active
                    ? 'font-medium text-[var(--color-accent)]'
                    : 'text-[var(--color-ink-2)]'
                }`}
              >
                <Glyph kind={item.icon} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
