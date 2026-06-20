'use client';

import { useId, useState, type ReactNode } from 'react';

interface Props {
  /** The visible trigger — usually a small clinical-term subtitle. */
  children: ReactNode;
  /** The plain-language definition shown on hover/focus. */
  hint: string;
}

/**
 * Sprint 25 — tiny info-tooltip primitive for the plain-first /
 * clinical-term-as-subtitle pattern.
 *
 * Renders the trigger inline (typically a clinical word like
 * "perpetuating") with a dotted underline; on hover/focus a small
 * popover shows the plain-language definition. No external library —
 * uses absolute positioning + a controlled open state.
 *
 * Accessible: the trigger is a real `<button>` so keyboard focus +
 * screen-readers reach it. The popover gets `role="tooltip"` and an
 * `aria-describedby` link to the trigger.
 */
export function InfoTip({ children, hint }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tooltipId = `infotip-${id}`;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-help border-b border-dotted border-[var(--color-ink-3)] text-xs text-[var(--color-ink-3)]"
      >
        {children}
      </button>
      {open && (
        <span
          id={tooltipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-1.5 w-64 -translate-x-1/2 rounded-lg border border-[var(--color-line-soft)] bg-white px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-2)] shadow-lg"
        >
          {hint}
        </span>
      )}
    </span>
  );
}
