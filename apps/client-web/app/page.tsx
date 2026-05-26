/**
 * Client-web home. Sprint 8 PR 2 fills this in with today's exercises +
 * mood card + next session reminder. PR 1 ships the shell so the QR
 * landing page has a place to bounce to after redeem.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-[var(--color-slate-500)]">
          Cureocity Mind
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--color-navy-700)]">Welcome back</h1>
      </header>
      <section className="rounded-2xl border border-[var(--color-slate-200)] bg-white p-6">
        <p className="text-sm text-[var(--color-slate-500)]">
          Your therapy home will live here — today&apos;s exercises, a mood check-in, and your next
          session reminder. Coming with Sprint 8 PR 2.
        </p>
      </section>
    </main>
  );
}
