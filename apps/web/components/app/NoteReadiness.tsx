'use client';

import type { ReadinessItem } from '../../lib/note-readiness';

/**
 * Sprint 62 — the "Is this note ready?" panel, shown above Sign off.
 *
 * These deterministic checks inspect text presence/length and recorded risk
 * flags. They never establish factual accuracy or clinical completeness.
 */
export function NoteReadiness({ items }: { items: ReadinessItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-ink)]">
        <p>Basic completeness checks passed. Review accuracy before signing.</p>
        <CheckScope />
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink)]">
        <span aria-hidden>💡</span>A few things to check before you sign
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
        Review these points against the session. The checks do not verify clinical accuracy.
      </p>
      <ul className="mt-3 space-y-2.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border border-[var(--color-line)] bg-white text-[10px] text-[var(--color-ink-3)]"
            >
              ◯
            </span>
            <span className="text-sm">
              <span className="font-medium text-[var(--color-ink)]">{item.label}.</span>{' '}
              <span className="text-[var(--color-ink-2)]">{item.hint}</span>
            </span>
          </li>
        ))}
      </ul>
      <CheckScope />
    </div>
  );
}

function CheckScope() {
  return (
    <details className="mt-2 text-xs text-[var(--color-ink-2)]">
      <summary className="cursor-pointer">What was checked?</summary>
      <p className="mt-2 max-w-prose leading-relaxed">
        Basic text presence and length in selected note sections, and whether a high or critical
        risk flag is recorded. These checks do not verify what happened, diagnose the client, or
        establish that a safety assessment was completed.
      </p>
    </details>
  );
}
