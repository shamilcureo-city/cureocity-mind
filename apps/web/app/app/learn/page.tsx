import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

const STEPS = [
  { n: 1, label: 'Welcome', done: false, active: true },
  { n: 2, label: 'Meet Klara', done: false, active: false },
  { n: 3, label: 'Session overview', done: false, active: false },
  { n: 4, label: 'Create your first note', done: false, active: false },
  { n: 5, label: 'Make it yours', done: false, active: false },
];

export default function LearnPage() {
  return (
    <Container className="py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Onboarding
        </p>
        <h1 className="mt-2 font-serif text-3xl">Learn Cureocity Mind</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-2)]">
          Five short steps to set the scribe up your way.
        </p>
      </header>

      <ol className="mb-8 flex flex-wrap items-center gap-2">
        {STEPS.map((s) => (
          <li key={s.n} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                s.active
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                  : s.done
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'border-[var(--color-line)] bg-white text-[var(--color-ink-3)]'
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-xs ${
                  s.active ? 'bg-white text-[var(--color-accent)]' : ''
                }`}
              >
                {s.done ? '✓' : s.n}
              </span>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      <Card className="p-10 text-center">
        <p className="font-serif text-xl">Full guided onboarding ships in Sprint 12.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-ink-2)]">
          Sample session, in-app tour, and consent-template generator land alongside the launch
          hardening sprint.
        </p>
      </Card>
    </Container>
  );
}
