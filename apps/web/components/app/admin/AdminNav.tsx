'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * PC2 — the super-admin console's own nav. A horizontal, wrapping bar at
 * the top of every /app/admin surface (the main app Sidebar stays to the
 * left). Order follows the console's mental model: pulse → who → money →
 * cost → growth/quality → compliance → products → plumbing → the ledger.
 */
export const ADMIN_NAV: { href: string; label: string }[] = [
  { href: '/app/admin', label: 'Overview' },
  { href: '/app/admin/accounts', label: 'Accounts' },
  { href: '/app/admin/billing', label: 'Billing' },
  { href: '/app/admin/costs', label: 'AI costs' },
  { href: '/app/admin/funnel', label: 'Growth' },
  { href: '/app/admin/competency', label: 'Quality' },
  { href: '/app/admin/compliance', label: 'Compliance' },
  { href: '/app/admin/care', label: 'Care' },
  { href: '/app/admin/system', label: 'System' },
  { href: '/app/admin/audit', label: 'Audit' },
];

export function AdminNav() {
  const path = usePathname() ?? '/app/admin';
  return (
    <nav
      className="mb-8 flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)] pb-1"
      aria-label="Admin console"
    >
      {ADMIN_NAV.map((item) => {
        const active =
          item.href === '/app/admin' ? path === '/app/admin' : path.startsWith(item.href);
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
