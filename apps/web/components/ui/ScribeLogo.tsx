import Link from 'next/link';

/** Doctor-facing identity, consistent with the Scribe sign-in page. */
export function ScribeLogo({ href = '/app/clinic' }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Cureocity Scribe"
      className="inline-flex min-h-11 items-center gap-2.5 rounded-lg text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
    >
      <span
        aria-hidden="true"
        className="u-tile u-tile-ink grid h-9 w-9 shrink-0 place-items-center rounded-xl"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 12h3l2.5-6 3 12 3-9 2 3H21"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="font-serif text-lg tracking-tight">Cureocity Scribe</span>
    </Link>
  );
}
