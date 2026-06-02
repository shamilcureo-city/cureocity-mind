import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

export default function TemplatesPage() {
  const tabs = [
    { label: 'My Templates', count: 0, active: true },
    { label: 'Your voice', count: 0, active: false },
    { label: 'Clinic shared', count: 0, active: false },
  ];
  return (
    <Container className="py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Format
          </p>
          <h1 className="mt-2 font-serif text-3xl">Templates</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-2)]">
            Templates set the structure of your notes. Your voice shapes how they are written.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white opacity-60"
        >
          + Create Template
        </button>
      </header>

      <div className="mb-6 flex items-center gap-2 border-b border-[var(--color-line-soft)]">
        {tabs.map((t) => (
          <button
            key={t.label}
            type="button"
            disabled
            className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${
              t.active
                ? 'border-[var(--color-ink)] font-medium text-[var(--color-ink)]'
                : 'border-transparent text-[var(--color-ink-3)]'
            }`}
          >
            {t.label}
            <span className="rounded-full bg-[var(--color-surface-soft)] px-1.5 text-xs tabular-nums">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <Card className="grid place-items-center py-20 text-center">
        <div className="max-w-md">
          <p className="font-serif text-xl">No custom templates yet.</p>
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            Templates are note formats you may want to create that the default set does not cover.
            The full editor ships in Sprint 7.
          </p>
        </div>
      </Card>
    </Container>
  );
}
