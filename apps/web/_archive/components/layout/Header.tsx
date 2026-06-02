import Link from 'next/link';
import { Container } from '../ui/Container';
import { ButtonLink } from '../ui/Button';
import { Wordmark } from './Wordmark';

const NAV: { label: string; href: string }[] = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Find a therapist', href: '/therapists' },
  { label: 'For therapists', href: '/for-therapists' },
  { label: 'About', href: '/#about' },
];

export function Header({ transparent = false }: { transparent?: boolean }) {
  return (
    <header
      className={`sticky top-0 z-30 ${
        transparent
          ? 'bg-transparent'
          : 'border-b border-[var(--color-line-soft)] bg-[var(--color-bg)]/85 backdrop-blur'
      }`}
    >
      <Container className="flex h-16 items-center justify-between gap-6">
        <Wordmark />
        <nav className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)] sm:inline"
          >
            Log in
          </Link>
          <ButtonLink href="/get-started" size="sm">
            Get matched
          </ButtonLink>
        </div>
      </Container>
    </header>
  );
}
