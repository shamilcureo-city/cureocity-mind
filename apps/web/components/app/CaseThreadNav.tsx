import Link from 'next/link';
import type { CaseThreadPosition } from '@/lib/case-thread';

/**
 * Sprint 73 — the "spine" of the case thread. Sits in the session
 * header and tells the therapist where this document sits in the
 * client's arc ("Session 3 of 6") with ‹ prev / next › chevrons that
 * walk the timeline without a trip back to the client page.
 *
 * Server component — pure Links, no interactivity.
 */
export function CaseThreadNav({ position }: { position: CaseThreadPosition }) {
  if (position.total <= 1) return null;

  return (
    <nav
      aria-label="Session timeline"
      className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-2)]"
    >
      <Chevron href={position.prevSessionId} direction="prev" />
      <span className="px-1 font-medium text-[var(--color-ink)]">
        Session {position.index}{' '}
        <span className="text-[var(--color-ink-3)]">of {position.total}</span>
      </span>
      <Chevron href={position.nextSessionId} direction="next" />
    </nav>
  );
}

function Chevron({ href, direction }: { href: string | null; direction: 'prev' | 'next' }) {
  const glyph = direction === 'prev' ? '‹' : '›';
  const label = direction === 'prev' ? 'Previous session' : 'Next session';
  const base =
    'flex h-6 w-6 items-center justify-center rounded-full text-base leading-none transition-colors';
  if (!href) {
    return (
      <span
        aria-hidden="true"
        className={`${base} cursor-default text-[var(--color-line)] opacity-50`}
      >
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={`/app/sessions/${href}`}
      aria-label={label}
      className={`${base} text-[var(--color-ink-2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]`}
    >
      {glyph}
    </Link>
  );
}
