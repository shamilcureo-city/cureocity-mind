import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

export default function KlaraPage() {
  return (
    <Container className="grid min-h-[70vh] place-items-center py-10">
      <Card className="w-full max-w-2xl p-12 text-center">
        <span
          aria-hidden
          className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 3v3M12 18v3M5 12H2M22 12h-3M5.6 5.6 3.5 3.5M18.4 5.6 20.5 3.5M5.6 18.4 3.5 20.5M18.4 18.4 20.5 20.5" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </span>
        <h1 className="mt-6 font-serif text-4xl">Klara</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          A secure AI assistant for your therapeutic practice.
        </p>
        <p className="mt-8 inline-block rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-4 py-2 text-sm text-[var(--color-ink-3)]">
          Chat, charts, and quick actions ship in Sprint 8.
        </p>
      </Card>
    </Container>
  );
}
