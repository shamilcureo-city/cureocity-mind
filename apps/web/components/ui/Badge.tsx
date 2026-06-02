import type { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'warn' | 'muted';

const tones: Record<Tone, string> = {
  default: 'bg-[var(--color-surface-soft)] text-[var(--color-ink-2)]',
  accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
  muted: 'bg-white text-[var(--color-ink-3)] border border-[var(--color-line)]',
};

export function Badge({
  children,
  tone = 'default',
  className = '',
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
