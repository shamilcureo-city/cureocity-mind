import { Container } from '@/components/ui/Container';
import { TemplatesEditor } from '@/components/app/TemplatesEditor';

export const dynamic = 'force-dynamic';

export default function TemplatesPage() {
  return (
    <Container className="py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Format
        </p>
        <h1 className="mt-2 font-serif text-3xl">Templates</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Templates define the section structure of the notes the AI drafts. The default
          template applies to new notes unless you pick another. Section ids are stable
          identifiers; titles + hints are what the model sees.
        </p>
      </header>
      <TemplatesEditor />
    </Container>
  );
}
