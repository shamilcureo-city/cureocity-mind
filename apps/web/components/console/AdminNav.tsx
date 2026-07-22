'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * The operator console's own nav. A horizontal, wrapping bar under the
 * console's top bar (this surface has no practitioner Sidebar — it lives
 * outside `/app`). Order follows the console's mental model: pulse → who →
 * money → cost → growth/quality → compliance → products → plumbing → the
 * ledger.
 */
export const ADMIN_NAV: { href: string; label: string }[] = [
  { href: '/console', label: 'Overview' },
  { href: '/console/accounts', label: 'Accounts' },
  { href: '/console/billing', label: 'Billing' },
  { href: '/console/costs', label: 'AI costs' },
  { href: '/console/funnel', label: 'Growth' },
  { href: '/console/competency', label: 'Quality' },
  { href: '/console/compliance', label: 'Compliance' },
  { href: '/console/care', label: 'Care' },
  { href: '/console/system', label: 'System' },
  { href: '/console/audit', label: 'Audit' },
];

export function AdminNav() {
  const path = usePathname() ?? '/console';
  return (
    <nav
      className="mb-8 flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)] pb-1"
      aria-label="Admin console"
    >
      {ADMIN_NAV.map((item) => {
        const active =
          item.href === '/console' ? path === '/console' : path.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              active
                ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]'
                : 'text-[var(--color-ink-2)] hover:bg-white/70 hover:text-[var(--color-ink)]'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
