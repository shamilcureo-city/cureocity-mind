import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { TherapistCard } from '@/components/public/TherapistCard';
import { fetchDirectory } from '@/lib/public-profile';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Find a therapist — Cureocity',
  description:
    'Verified therapists across India. Filter by specialty, language, and city; request an appointment online.',
};

/**
 * Marketing V1 — the PUBLIC therapist directory. Anonymous traffic;
 * only published profiles appear. Filters ride plain query params so
 * results are linkable and crawlable.
 */
export default async function TherapistDirectoryPage({
  searchParams,
}: {
  searchParams: Promise<{ specialty?: string; language?: string; city?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const therapists = await fetchDirectory({
    specialty: sp.specialty,
    language: sp.language,
    city: sp.city,
    q: sp.q,
  });

  // Facet values from the live result set — no separate taxonomy to drift.
  const specialties = [...new Set(therapists.flatMap((t) => t.specialties))].sort();
  const cities = [...new Set(therapists.map((t) => t.locationCity).filter(Boolean))].sort();
  const activeFilter = sp.specialty ?? sp.city ?? null;

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <Container className="py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Cureocity
        </p>
        <h1 className="mt-2 font-serif text-4xl">Find a therapist</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">
          Verified practitioners across India. Every profile is a real, RCI-registered therapist —
          request a time that works for you and hear back the same day.
        </p>

        {(specialties.length > 0 || cities.length > 0) && (
          <nav className="mt-8 flex flex-wrap items-center gap-2" aria-label="Filters">
            {activeFilter && (
              <Link
                href="/therapists"
                className="rounded-full border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-1.5 text-sm text-white"
              >
                {activeFilter} ✕
              </Link>
            )}
            {!sp.specialty &&
              specialties.slice(0, 8).map((s) => (
                <Link
                  key={s}
                  href={`/therapists?specialty=${encodeURIComponent(s)}`}
                  className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-4 py-1.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  {s}
                </Link>
              ))}
            {!sp.city &&
              cities.slice(0, 6).map((c) => (
                <Link
                  key={c}
                  href={`/therapists?city=${encodeURIComponent(c!)}`}
                  className="rounded-full border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-4 py-1.5 text-sm text-[var(--color-ink-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                >
                  {c}
                </Link>
              ))}
          </nav>
        )}

        {therapists.length === 0 ? (
          <div className="mt-16 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-10 text-center">
            <p className="font-serif text-xl">No therapists match yet</p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Try clearing the filter, or check back soon — new practitioners join every week.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {therapists.map((t) => (
              <TherapistCard key={t.publicSlug} therapist={t} />
            ))}
          </div>
        )}

        <p className="mt-16 border-t border-[var(--color-line-soft)] pt-6 text-xs text-[var(--color-ink-3)]">
          Are you a therapist?{' '}
          <Link href="/" className="font-medium text-[var(--color-accent)] hover:underline">
            Get your own page with Cureocity Mind →
          </Link>
        </p>
      </Container>
    </main>
  );
}
