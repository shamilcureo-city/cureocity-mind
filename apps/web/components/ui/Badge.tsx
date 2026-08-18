import type { ReactNode } from 'react';

type Tone = 'default' | 'accent' | 'warn' | 'muted';

// v10 — accent reads as a solid ink pill (the emphatic state), the rest stay
// light chips with a top rim so they sit on the glass rather than in it.
const tones: Record<Tone, string> = {
  default:
    'bg-[linear-gradient(180deg,#fff,var(--color-surface-soft))] text-[var(--color-ink-2)] shadow-[inset_0_1px_0_#fff,0_4px_10px_-8px_rgba(35,45,95,0.4)]',
  accent: 'u-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_6px_14px_-8px_rgba(11,12,16,0.55)]',
  warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]',
  muted: 'bg-white/80 text-[var(--color-ink-3)] border border-white/90 shadow-[var(--sh-raise)]',
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
