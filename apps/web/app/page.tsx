import Link from 'next/link';

/**
 * Root role selector. Two installable PWAs merged into one Next.js
 * app; the user picks their entry point here.
 *
 * Therapists go to /t/login (Firebase phone OTP).
 * Clients arrive via a claim link from their therapist (/c/claim/[token]);
 * once paired, the install prompt and subsequent visits land them on /c.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Cureocity Mind
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">Welcome</h1>
        <p className="mt-3 text-sm text-[var(--color-slate-500)]">
          Ambient therapy scribe for psychologists, between-session companion for clients.
        </p>
      </header>

      <div className="space-y-3">
        <Link
          href="/t/login"
          className="block rounded-2xl border border-[var(--color-navy-500)] bg-[var(--color-navy-700)] px-5 py-4 text-center text-white"
        >
          <p className="font-semibold">I&apos;m a therapist</p>
          <p className="mt-1 text-xs text-[var(--color-navy-50)]">
            Sign in with your phone number
          </p>
        </Link>

        <div className="rounded-2xl border border-[var(--color-slate-200)] bg-white px-5 py-4 text-center">
          <p className="font-semibold text-[var(--color-navy-700)]">I have a link from my therapist</p>
          <p className="mt-1 text-xs text-[var(--color-slate-500)]">
            Open the link they sent you to pair this device.
          </p>
        </div>
      </div>
    </main>
  );
}
