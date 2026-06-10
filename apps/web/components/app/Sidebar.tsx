'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: 'record' | 'clients' | 'templates' | 'klara' | 'learn' | 'me';
}

const PRIMARY: NavItem[] = [
  { href: '/app', label: 'Record', icon: 'record' },
  { href: '/app/clients', label: 'Clients', icon: 'clients' },
  { href: '/app/templates', label: 'Templates', icon: 'templates' },
  { href: '/app/klara', label: 'Klara AI', icon: 'klara' },
  { href: '/app/me', label: 'My practice', icon: 'me' },
  { href: '/app/learn', label: 'Learn', icon: 'learn' },
];

export interface PlanUsage {
  /// Sessions recorded against the free pilot allowance.
  used: number;
  cap: number;
}

interface SidebarProps {
  /// Real usage computed by the app layout (server). Null hides the
  /// widget (e.g. unauthenticated edge states).
  usage?: PlanUsage | null;
}

export function Sidebar({ usage = null }: SidebarProps) {
  const path = usePathname() ?? '/app';
  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] md:flex">
      <div className="px-6 py-6">
        <Link href="/app" className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] font-serif text-base text-white"
          >
            cm
          </span>
          <span className="font-serif text-lg tracking-tight">Cureocity Mind</span>
        </Link>
      </div>

      <nav className="px-3" aria-label="Primary">
        <ul className="space-y-1">
          {PRIMARY.map((item) => {
            const active = item.href === '/app' ? path === '/app' : path.startsWith(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? 'bg-white font-medium text-[var(--color-ink)] shadow-sm'
                      : 'text-[var(--color-ink-2)] hover:bg-white/60 hover:text-[var(--color-ink)]'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Glyph kind={item.icon} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-auto px-4 pb-6">
        <PlanWidget usage={usage} />
        <FooterLinks />
      </div>
    </aside>
  );
}

function PlanWidget({ usage }: { usage: PlanUsage | null }) {
  if (!usage) return null;
  const pct = Math.min(100, Math.round((usage.used / usage.cap) * 100));
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Free pilot</p>
        <Link
          href="/app/settings/plan"
          className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
        >
          Plan
        </Link>
      </div>
      <div className="mt-3 flex items-baseline justify-between text-xs text-[var(--color-ink-3)]">
        <span>Sessions</span>
        <span className="tabular-nums">
          {usage.used} of {usage.cap}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-line-soft)]">
        <div className="h-full bg-[var(--color-accent)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FooterLinks() {
  const items: { href: string; label: string; icon: 'cog' | 'help' | 'signout' }[] = [
    { href: '/app/settings', label: 'Settings', icon: 'cog' },
    { href: '/app/learn', label: 'Get Help', icon: 'help' },
    { href: '/api/v1/auth/signout', label: 'Sign out', icon: 'signout' },
  ];
  return (
    <ul className="mt-4 space-y-1">
      {items.map((it) => (
        <li key={it.href}>
          <Link
            href={it.href}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-[var(--color-ink-2)] hover:bg-white/60 hover:text-[var(--color-ink)]"
          >
            <Glyph kind={it.icon} />
            {it.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Glyph({
  kind,
}: {
  kind:
    | 'record'
    | 'clients'
    | 'templates'
    | 'klara'
    | 'learn'
    | 'me'
    | 'gift'
    | 'cog'
    | 'help'
    | 'signout';
}) {
  const paths: Record<typeof kind, string> = {
    record: 'M12 4a4 4 0 0 1 4 4v4a4 4 0 0 1-8 0V8a4 4 0 0 1 4-4zM5 12a7 7 0 0 0 14 0M12 19v3',
    clients: 'M16 14a4 4 0 1 0-8 0M3 21v-1a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v1',
    templates:
      'M7 4h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8h6M9 12h6M9 16h4',
    klara:
      'M12 3v3M12 18v3M5 12H2M22 12h-3M5.6 5.6 3.5 3.5M18.4 5.6 20.5 3.5M5.6 18.4 3.5 20.5M18.4 18.4 20.5 20.5',
    learn: 'M4 5h12a3 3 0 0 1 3 3v11a2 2 0 0 0-2-2H4V5zM4 17h12',
    me: 'M3 12h3l3-8 4 16 3-8h5',
    gift: 'M3 9h18v4H3zM12 9v13M5 13v8h14v-8M8 9c0-2 1-4 4-4s4 2 4 4',
    cog: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
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
