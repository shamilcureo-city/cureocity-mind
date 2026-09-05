'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type PractitionerVertical } from '@cureocity/contracts';
import { Glyph } from '@/components/app/Sidebar';
import { practitionerNavigation } from '@/lib/practitioner-navigation';
import { useModalA11y } from '@/lib/use-modal-a11y';

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
  const { primary: items, secondary } = practitionerNavigation(vertical, 'mobile');
  const hasMore = secondary.length > 0;
  const cols = items.length + (hasMore ? 1 : 0);

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
            className="u-glass absolute inset-x-0 bottom-14 rounded-t-2xl p-3 pb-4"
          >
            <ul className="grid grid-cols-3 gap-1.5">
              {secondary.map((item) => (
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
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/80 bg-white/70 shadow-[0_-12px_30px_-22px_rgba(35,45,95,0.5)] backdrop-blur-xl md:hidden print:!hidden ${vertical === 'THERAPIST' ? 'mind-mobile-nav' : ''}`}
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
          {hasMore && (
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
