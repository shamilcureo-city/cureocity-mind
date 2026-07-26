import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { TherapistCard } from '@/components/public/TherapistCard';
import { fetchDirectory, nextSlotByTherapist } from '@/lib/public-profile';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * MK5 — per-specialty SEO landing page ("Therapists for Anxiety").
 * Specialty values are free-text on profiles, so the match is
 * case-insensitive against the declared list.
 */

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ specialty: string }>;
}): Promise<Metadata> {
  const { specialty } = await params;
  const name = titleCase(decodeURIComponent(specialty));
  return {
    title: `${name} therapists — verified, book online | Cureocity`,
    description: `RCI-registered therapists who work with ${name.toLowerCase()}. See real available times and request an appointment online.`,
  };
}

export default async function SpecialtyPage({
  params,
}: {
  params: Promise<{ specialty: string }>;
}) {
  const { specialty } = await params;
  const wanted = decodeURIComponent(specialty).toLowerCase();
  const name = titleCase(wanted);

  // Specialty casing varies per profile; resolve the canonical casing
  // from the live supply, then reuse the directory loader.
  const all = await prisma.psychologist.findMany({
    where: {
      deletedAt: null,
      vertical: 'THERAPIST',
      profilePublishedAt: { not: null },
      publicSlug: { not: null },
    },
    select: { specialties: true },
  });
  const canonical = [...new Set(all.flatMap((t) => t.specialties))].find(
    (s) => s.toLowerCase() === wanted,
  );

  const therapists = canonical ? await fetchDirectory({ specialty: canonical }) : [];
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
        <h1 className="mt-3 font-serif text-4xl">Therapists for {name}</h1>
        <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">
          Verified practitioners who work with {name.toLowerCase()}. Every profile shows real
          available times — request one and the slot is held for you.
        </p>
        {therapists.length === 0 ? (
          <div className="mt-16 rounded-2xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-10 text-center">
            <p className="font-serif text-xl">No published therapists for {name} yet</p>
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
