import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Container } from '@/components/ui/Container';
import { TherapistCard } from '@/components/therapist/TherapistCard';
import { DirectoryFilters } from '@/components/therapist/DirectoryFilters';
import { fetchPublicTherapists, fetchAllFilterFacets } from '@/lib/directory';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    specialty?: string;
    language?: string;
    modality?: string;
    city?: string;
    accepting?: string;
  }>;
}

export default async function TherapistsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const [therapists, facets] = await Promise.all([
    fetchPublicTherapists({
      ...(sp.specialty && { specialty: sp.specialty }),
      ...(sp.language && { language: sp.language }),
      ...(sp.modality && { modality: sp.modality }),
      ...(sp.city && { city: sp.city }),
      acceptingOnly: sp.accepting === '1',
    }),
    fetchAllFilterFacets(),
  ]);

  return (
    <>
      <Header />
      <main className="pb-24">
        <Container className="pt-14">
          <header className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              The directory
            </p>
            <h1 className="mt-3 font-serif text-5xl leading-tight">
              Browse therapists. Filter for the fit you want.
            </h1>
            <p className="mt-4 text-[var(--color-ink-2)]">
              Every therapist here is RCI-registered and personally interviewed. Use the filters to
              narrow by approach, language, or city — or let us match you.
            </p>
          </header>

          <div className="mt-10">
            <DirectoryFilters facets={facets} />
          </div>

          <div className="mt-8 flex items-baseline justify-between">
            <p className="text-sm text-[var(--color-ink-3)]">
              Showing {therapists.length} therapist{therapists.length === 1 ? '' : 's'}
            </p>
          </div>

          {therapists.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-dashed border-[var(--color-line)] bg-white p-12 text-center">
              <p className="font-serif text-xl">No matches with these filters.</p>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                Try removing a filter, or tell us what you need and we will reach out.
              </p>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {therapists.map((t) => (
                <TherapistCard key={t.id} therapist={t} />
              ))}
            </div>
          )}
        </Container>
      </main>
      <Footer />
    </>
  );
}
