import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-bg)] p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          404
        </p>
        <h1 className="mt-3 font-serif text-3xl">This page doesn&rsquo;t exist.</h1>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          The link may be old, or the record may have been removed.
        </p>
        <Link
          href="/app"
          className="mt-6 inline-block rounded-xl bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white"
        >
          Back to your dashboard
        </Link>
      </div>
    </main>
  );
}
