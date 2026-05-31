import Link from 'next/link';

/**
 * Therapist landing post-login. V1 placeholder — the real clients list
 * + new-client CTA lands in a later sprint. For now we render a basic
 * shell so the post-login redirect doesn't 404 in demo mode (Firebase
 * not configured).
 */
export default function ClientsIndexPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Cureocity Mind · Therapist
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">Clients</h1>
        <p className="mt-2 text-sm text-[var(--color-slate-500)]">
          You&apos;re signed in. The clients list and new-client flow ship in the next sprint —
          the API endpoints are live now (POST /api/v1/clients, GET /api/v1/clients) but the UI
          wiring isn&apos;t done yet.
        </p>
      </header>

      <section className="rounded-2xl border border-[var(--color-navy-500)] bg-[var(--color-navy-50)] p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-slate-500)]">
          Try the backend directly
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <code className="rounded bg-white px-2 py-1 text-xs">GET /api/v1/health</code>
            {' — '}
            <Link href="/api/v1/health" className="underline">
              open
            </Link>
          </li>
          <li>
            <code className="rounded bg-white px-2 py-1 text-xs">GET /api/v1/clients</code>
            {' — requires Firebase ID token'}
          </li>
          <li>
            <code className="rounded bg-white px-2 py-1 text-xs">
              POST /api/v1/psychologists
            </code>
            {' — creates a therapist record (idempotent)'}
          </li>
        </ul>
      </section>

      <p className="mt-8 text-center text-xs text-[var(--color-slate-500)]">
        <Link href="/" className="underline">
          ← Back to home
        </Link>
      </p>
    </main>
  );
}
