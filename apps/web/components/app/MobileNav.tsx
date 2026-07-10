'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type PractitionerVertical } from '@cureocity/contracts';
import { Glyph } from '@/components/app/Sidebar';

// Sprint 45 — Today is the morning landing screen on phones too. Mobile
// is capped at 5 grid cols. Sprint TS3 — the bottom bar now mirrors the
// desktop primary spine's top five (Today · Record · Clients · Search ·
// Templates); Dashboard / Assistant moved to the desktop "More" group and
// aren't in-session phone tools, same rationale as Settings / My practice
// dropping off earlier.
const ITEMS: {
  href: string;
  label: string;
  icon: 'today' | 'record' | 'clients' | 'search' | 'templates' | 'clinic' | 'insights' | 'cog';
}[] = [
  { href: '/app/today', label: 'Today', icon: 'today' },
  { href: '/app', label: 'Record', icon: 'record' },
  { href: '/app/clients', label: 'Clients', icon: 'clients' },
  { href: '/app/search', label: 'Search', icon: 'search' },
  { href: '/app/templates', label: 'Templates', icon: 'templates' },
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
 */
export function MobileNav({ vertical = 'THERAPIST' }: { vertical?: PractitionerVertical }) {
  const path = usePathname() ?? '/app';
  const items = vertical === 'DOCTOR' ? DOCTOR_ITEMS : ITEMS;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]/95 backdrop-blur md:hidden"
    >
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
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
      </ul>
    </nav>
  );
}
