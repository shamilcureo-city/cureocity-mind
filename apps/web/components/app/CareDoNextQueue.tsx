import type { CareAction, CareActionPriority } from '@cureocity/contracts';
import { Card } from '../ui/Card';

interface Props {
  queue: CareAction[];
}

const PRIORITY_META: Record<CareActionPriority, { label: string; chip: string }> = {
  SAFETY: { label: 'Safety', chip: 'bg-[#a03b34] text-white' },
  MEASURE: { label: 'Measure', chip: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]' },
  DIAGNOSE: { label: 'Diagnose', chip: 'bg-[#f6efdc] text-[#8a7434]' },
  PLAN: { label: 'Plan', chip: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' },
  OUTCOME: {
    label: 'Outcome',
    chip: 'bg-white text-[var(--color-ink-3)] border border-[var(--color-line)]',
  },
};

const WHEN_LABEL: Record<CareAction['when'], string> = {
  this_session: 'This session',
  next_session: 'Next session',
};

/**
 * Sprint JE3 — Do next, zone [2] of the Care Engine page.
 *
 * The single ranked action list — the one that killed the "set a baseline"
 * ×4 duplication (there were two competing action engines before). Strict
 * priority order (SAFETY > MEASURE > DIAGNOSE > PLAN > OUTCOME); every card
 * names the gate it unlocks, and carries the anchor id the Care Arc's gate
 * criteria jump to. The engine emits at most one action per priority band
 * (≤5 total), so the whole queue renders inline — nothing is hidden behind
 * an expander, which also guarantees every gate jump-link has a live target.
 */
export function CareDoNextQueue({ queue }: Props) {
  if (queue.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Do next
        </p>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          You&rsquo;re all caught up — nothing is blocking the next stage right now.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
          Do next
        </p>
        <p className="text-xs text-[var(--color-ink-3)]">{queue.length} open · in priority order</p>
      </header>

      <ol className="mt-4 space-y-3">
        {queue.map((a, i) => (
          <ActionRow key={a.id} action={a} lead={i === 0} />
        ))}
      </ol>
    </Card>
  );
}

function ActionRow({ action, lead }: { action: CareAction; lead: boolean }) {
  const meta = PRIORITY_META[action.priority];
  return (
    <li
      id={`care-action-${action.id}`}
      className={`scroll-mt-24 rounded-2xl border p-4 ${
        lead
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40'
          : 'border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}
        >
          {meta.label}
        </span>
        <span className="text-[11px] uppercase tracking-wide text-[var(--color-ink-3)]">
          {WHEN_LABEL[action.when]}
        </span>
      </div>
      <p className="mt-2 font-medium text-[var(--color-ink)]">{action.title}</p>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">{action.why}</p>
      {action.unlocks && (
        <p className="mt-1.5 text-xs text-[var(--color-ink-3)]">
          <span className="font-medium">Unlocks:</span> {action.unlocks}
        </p>
      )}
      {action.ctaLabel && action.ctaHref && (
        <a
          href={action.ctaHref}
          className="mt-3 inline-flex items-center rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
        >
          {action.ctaLabel}
        </a>
      )}
    </li>
  );
}
