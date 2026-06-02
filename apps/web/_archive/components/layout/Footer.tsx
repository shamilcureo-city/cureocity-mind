import Link from 'next/link';
import { Container } from '../ui/Container';
import { Wordmark } from './Wordmark';

const COLS = [
  {
    heading: 'Care',
    links: [
      { label: 'Find a therapist', href: '/therapists' },
      { label: 'How matching works', href: '/#how-it-works' },
      { label: 'Get started', href: '/get-started' },
      { label: 'In a crisis', href: '/#crisis' },
    ],
  },
  {
    heading: 'For therapists',
    links: [
      { label: 'Join the practice', href: '/for-therapists' },
      { label: 'Therapist log in', href: '/login' },
      { label: 'Practice tools', href: '/for-therapists#tools' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/#about' },
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' },
      { label: 'Contact', href: '/#contact' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="max-w-sm">
            <Wordmark />
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-ink-2)]">
              Thoughtful matching between people who want support and therapists they can trust.
              Independent, evidence-led, human-first.
            </p>
          </div>
          {COLS.map((col) => (
            <div key={col.heading}>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
                {col.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-[var(--color-line)] pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-[var(--color-ink-3)]">
            © {new Date().getFullYear()} Cureocity Mind. All rights reserved.
          </p>
          <p className="text-xs text-[var(--color-ink-3)]">
            If you are in immediate danger, call your local emergency line or{' '}
            <Link href="/#crisis" className="underline">
              see local crisis resources
            </Link>
            .
          </p>
        </div>
      </Container>
    </footer>
  );
}
