'use client';

import type { ReadinessItem } from '../../lib/note-readiness';

/**
 * Sprint 62 — the "Is this note ready?" panel, shown above Sign off.
 *
 * Calm and never blocking: if the note looks complete it offers a quiet
 * reassurance; otherwise it lists a few friendly things to check, each
 * with a "why". The therapist can act on them or sign anyway — they're
 * suggestions, not gates.
 */
export function NoteReadiness({ items }: { items: ReadinessItem[] }) {
  if (items.length === 0) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-accent-soft)]/40 px-4 py-3 text-sm text-[var(--color-ink)]">
        <span aria-hidden>✓</span>
        <span>This note looks complete. You’re good to sign.</span>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink)]">
        <span aria-hidden>💡</span>A few things to check before you sign
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">
        These are just suggestions — you can fix them now, or sign anyway.
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
    </div>
  );
}
