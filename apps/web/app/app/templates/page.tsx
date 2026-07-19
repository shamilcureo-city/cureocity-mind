import { Container } from '@/components/ui/Container';
import { TemplatesEditor } from '@/components/app/TemplatesEditor';
import { requireOnboardedPsychologist } from '@/lib/auth-page';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  await requireOnboardedPsychologist(); // defense-in-depth: the /app layout does not redirect
  return (
    <Container className="py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Format
        </p>
        <h1 className="mt-2 font-serif text-3xl">Templates</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Templates define the sections of the notes the AI drafts — the headings, their order, and
          a hint for what belongs in each. The default template applies to new notes unless you pick
          another on the note itself.
        </p>
      </header>
      <TemplatesEditor />
    </Container>
  );
}
