import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * PC2 — shared presentational primitives for the super-admin console. One
 * file so every admin surface (built here and fanned out) reads as one
 * system: same tiles, cards, pills, tables, spacing. Server-safe (no
 * 'use client') — interactive bits live in per-page client components.
 */

export function AdminPageHeader({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-serif text-3xl">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">{description}</p>
        )}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</section>;
}

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'danger';
  href?: string;
}) {
  const border =
    tone === 'accent'
      ? 'border-[var(--color-accent)]'
      : tone === 'danger'
        ? 'border-[var(--color-danger,#B42318)]'
        : tone === 'warn'
          ? 'border-[var(--color-warn)]'
          : tone === 'good'
            ? 'border-[var(--color-good,#0E7A4A)]'
            : 'border-[var(--color-line-soft)]';
  const valueColor =
    tone === 'danger'
      ? 'text-[var(--color-danger,#B42318)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : 'text-[var(--color-ink)]';
  const inner = (
    <div
      className={`h-full rounded-2xl border bg-[var(--color-surface)] p-5 transition-colors ${border} ${
        href ? 'hover:border-[var(--color-accent)]' : ''
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">{label}</p>
      <p className={`mt-1 font-serif text-3xl tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--color-ink-3)]">{sub}</p>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function AdminCard({
  title,
  hint,
  right,
  children,
  className = '',
}: {
  title?: string;
  hint?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--color-line-soft)] bg-white/60 p-6 ${className}`}
    >
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            {title && (
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-3)]">
                {title}
              </h2>
            )}
            {hint && <p className="mt-1 text-xs text-[var(--color-ink-3)]">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export type PillTone = 'good' | 'warn' | 'danger' | 'muted' | 'accent';

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  const styles: Record<PillTone, string> = {
    good: 'bg-[var(--color-good-soft,#E9F5EF)] text-[var(--color-good,#0E7A4A)]',
    warn: 'bg-[var(--color-warn-soft)] text-[var(--color-warn)]',
    danger: 'bg-[var(--color-danger-soft,#FDEBE9)] text-[var(--color-danger,#B42318)]',
    muted: 'border border-[var(--color-line)] text-[var(--color-ink-3)]',
    accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

// ----- table primitives -----

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Thead({ cols }: { cols: { label: string; align?: 'left' | 'right' }[] }) {
  return (
    <thead>
      <tr className="text-xs text-[var(--color-ink-3)]">
        {cols.map((c) => (
          <th
            key={c.label}
            className={`pb-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function Tr({ children }: { children: ReactNode }) {
  return <tr className="border-t border-[var(--color-line-soft)]">{children}</tr>;
}

export function Td({
  children,
  align = 'left',
  nums = false,
  muted = false,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  nums?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${
        nums ? 'tabular-nums' : ''
      } ${muted ? 'text-[var(--color-ink-3)]' : ''}`}
    >
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-4 text-sm text-[var(--color-ink-3)]">
        {children}
      </td>
    </tr>
  );
}

/** Compact key→value row, for config/topology readouts. */
export function DefRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-[var(--color-line-soft)] py-2 text-sm first:border-t-0">
      <span className="text-[var(--color-ink-2)]">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </div>
  );
}

/** Set / missing badge for a config presence check (never shows the value). */
export function PresenceBadge({
  set,
  okText = 'set',
  missingText = 'missing',
}: {
  set: boolean;
  okText?: string;
  missingText?: string;
}) {
  return set ? <Pill tone="good">{okText}</Pill> : <Pill tone="warn">{missingText}</Pill>;
}

/** Format an INR integer with the ₹ symbol + Indian digit grouping. */
export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
