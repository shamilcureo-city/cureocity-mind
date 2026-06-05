import { Container } from '@/components/ui/Container';
import { KlaraChat } from '@/components/app/KlaraChat';

export const dynamic = 'force-dynamic';

export default function KlaraPage() {
  return (
    <Container className="py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Assistant
        </p>
        <h1 className="mt-2 font-serif text-3xl">Klara</h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--color-ink-2)]">
          A private AI assistant grounded in your practice. Ask about your roster, recent
          sessions, or how to prepare for what's next.
        </p>
      </header>
      <KlaraChat />
    </Container>
  );
}
