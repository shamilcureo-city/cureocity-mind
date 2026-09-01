'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Props {
  clientId: string;
}

const items = [
  { key: 'overview', label: 'Overview', suffix: '' },
  { key: 'journey', label: 'Journey & outcomes', suffix: '/journey' },
  { key: 'plan', label: 'Plan of care', suffix: '/plan' },
  { key: 'sessions', label: 'Sessions', suffix: '/sessions' },
  { key: 'shared', label: 'Shared with client', suffix: '/shared' },
] as const;

export function ClientWorkspaceNav({ clientId }: Props) {
  const pathname = usePathname();
  const base = `/app/clients/${clientId}`;

  return (
    <nav
      aria-label="Client workspace"
      className="overflow-x-auto border-b border-[var(--color-line)]"
    >
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const href = `${base}${item.suffix}`;
          const active = item.suffix === '' ? pathname === base : pathname.startsWith(href);
          return (
            <li key={item.key}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  active
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
