import Link from 'next/link';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';

export const dynamic = 'force-dynamic';

const TABS = [
  { href: '/app/settings/account', label: 'Account' },
  { href: '/app/settings/clinic', label: 'Clinic' },
  { href: '/app/settings/preferences', label: 'Preferences' },
  { href: '/app/settings/security', label: 'Security' },
  { href: '/app/settings/plan', label: 'Plan & usage' },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <Container className="py-10">
      <p className="mb-4 text-xs text-[var(--color-ink-3)]">
        <Link href="/app" className="hover:text-[var(--color-ink)]">
          ← Dashboard
        </Link>
      </p>

      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Workspace
        </p>
        <h1 className="mt-2 font-serif text-3xl">Settings</h1>
      </header>

      <nav
        className="mb-8 flex flex-wrap items-center gap-1 border-b border-[var(--color-line-soft)]"
        aria-label="Settings sections"
      >
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="border-b-2 border-transparent px-3 py-2.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </Container>
  );
}
