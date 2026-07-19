import { Container } from '@/components/ui/Container';
import { NoteSearch } from '@/components/app/NoteSearch';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

/**
 * Sprint 67 — cross-note search page.
 *
 * Find the moment you're thinking of across every signed note in your
 * caseload, then jump straight to that session.
 */
export default async function SearchPage() {
  await requireOnboardedPsychologist();
  return (
    <Container className="py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Search
        </p>
        <h1 className="mt-2 font-serif text-3xl">Search your notes</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Look across every signed note in your caseload — a topic, a name, a phrase — and open the
          session it came from. Only your own clients’ notes are searched.
        </p>
      </header>
      <NoteSearch />
    </Container>
  );
}
