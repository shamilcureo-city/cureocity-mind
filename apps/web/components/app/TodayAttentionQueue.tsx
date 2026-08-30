import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { TodayAttentionItem } from '@/lib/today-priority';

const labels: Record<TodayAttentionItem['kind'], string> = {
  ACTIVE_SESSION: 'Active session',
  FUTURE_SESSION: 'Next session',
  NOTE_NEEDS_ATTENTION: 'Needs attention',
  NOTE_REVIEW: 'Ready to review',
  NOTE_GENERATING: 'Generating',
  CLIENT_RESPONSE: 'Client response',
  OVERDUE_WORK: 'Overdue',
};

export function TodayAttentionQueue({ items }: { items: readonly TodayAttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-8" aria-label="Needs your attention">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
        Needs your attention
      </h2>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--color-line-soft)]">
          {items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--color-accent)]">
                  {labels[item.kind]}
                </p>
                <p className="truncate text-sm font-medium text-[var(--color-ink)]">{item.title}</p>
                {item.detail ? (
                  <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{item.detail}</p>
                ) : null}
              </div>
              <Link
                href={item.href}
                className="shrink-0 rounded-full bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
              >
                {item.ctaLabel}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
