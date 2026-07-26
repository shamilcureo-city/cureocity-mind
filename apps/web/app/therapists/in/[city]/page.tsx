import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { TherapistCard } from '@/components/public/TherapistCard';
import { fetchDirectory, nextSlotByTherapist } from '@/lib/public-profile';

export const dynamic = 'force-dynamic';

/**
 * MK5 — per-city SEO landing page ("Therapists in Kochi"). Same data
 * as the directory with a city filter; a crawlable page per supply
 * city, listed in the sitemap.
 */

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  const { city } = await params;
  const name = titleCase(decodeURIComponent(city));
  return {
    title: `Therapists in ${name} — verified, book online | Cureocity`,
    description: `RCI-registered therapists in ${name}. See real available times and request an appointment online.`,
  };
}

export default async function CityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const name = titleCase(decodeURIComponent(city));
  const therapists = await fetchDirectory({ city: decodeURIComponent(city) });
  const nextSlots = await nextSlotByTherapist(therapists.map((t) => t.id));

  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <Container className="py-14">
        <Link
          href="/therapists"
          className="text-sm text-[var(--color-ink-3)] hover:text-[var(--color-accent)]"
        >
          ← All therapists
        </Link>
        <h1 className="mt-3 font-serif text-4xl">Therapists in {name}</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">
          Verified, RCI-registered practitioners in {name}. Every profile shows real available times
          — request one and the slot is held for you.
        </p>
        {therapists.length === 0 ? (
          <div className="mt-16 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-10 text-center">
            <p className="font-serif text-xl">No published therapists in {name} yet</p>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              <Link href="/therapists" className="text-[var(--color-accent)] hover:underline">
                Browse everyone →
              </Link>
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {therapists.map((t) => (
              <TherapistCard key={t.publicSlug} therapist={t} nextSlotAt={nextSlots.get(t.id)} />
            ))}
          </div>
        )}
      </Container>
    </main>
  );
}
