import Link from 'next/link';
import type { ReactNode } from 'react';
import { Container } from '@/components/ui/Container';

/**
 * LEGAL-1 — shared shell for /terms and /privacy.
 *
 * These are real, honest legal documents required before a pilot: the login
 * page asserts consent to them, and DPDP requires a published notice + a named
 * grievance officer. The company legal name and grievance contact are
 * env-driven so the founder sets the verified values before launch without a
 * code change (defaults are placeholders — CONFIRM them with counsel).
 */
export const COMPANY_LEGAL_NAME =
  process.env['NEXT_PUBLIC_COMPANY_LEGAL_NAME'] ?? 'Cureocity Health Tech LLP';
export const GRIEVANCE_EMAIL =
  process.env['NEXT_PUBLIC_GRIEVANCE_EMAIL'] ?? 'privacy@cureocity.health';
export const LEGAL_EFFECTIVE_DATE = '7 July 2026';

export function LegalShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] py-14">
      <Container className="max-w-[760px]">
        <nav className="mb-10 flex items-center justify-between text-sm">
          <Link href="/" className="text-[var(--color-ink-2)] hover:text-[var(--color-ink)]">
            ← Cureocity Mind
          </Link>
          <span className="flex gap-4 text-[var(--color-ink-3)]">
            <Link href="/terms" className="hover:text-[var(--color-ink)]">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--color-ink)]">
              Privacy
            </Link>
          </span>
        </nav>

        <header className="mb-10 border-b border-[var(--color-line-soft)] pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            {COMPANY_LEGAL_NAME}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-tight text-[var(--color-ink)]">
            {title}
          </h1>
          <p className="mt-2 text-sm text-[var(--color-ink-3)]">Effective {LEGAL_EFFECTIVE_DATE}</p>
          <p className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-[var(--color-ink-2)]">
            {intro}
          </p>
        </header>

        <div className="flex flex-col gap-9 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
          {children}
        </div>

        <footer className="mt-14 border-t border-[var(--color-line-soft)] pt-6 text-[13px] text-[var(--color-ink-3)]">
          Questions or a data-protection request? Write to our Grievance Officer at{' '}
          <a href={`mailto:${GRIEVANCE_EMAIL}`} className="text-[var(--color-accent)]">
            {GRIEVANCE_EMAIL}
          </a>
          . We respond within the timelines required by India&apos;s Digital Personal Data
          Protection Act, 2023.
        </footer>
      </Container>
    </main>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 font-serif text-xl text-[var(--color-ink)]">{heading}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}
