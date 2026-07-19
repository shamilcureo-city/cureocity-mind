'use client';

import { useState } from 'react';

/**
 * UI truth pass (2026-07 audit) — a copyable identifier chip. The session-info
 * tab used to show a truncated ID ("cmrs7wsqs001…") with no way to copy it,
 * which is useless for the one thing an ID is for (support / debugging).
 */
export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="break-all font-mono text-xs text-[var(--color-ink)]">{value}</span>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-3)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </span>
  );
}
