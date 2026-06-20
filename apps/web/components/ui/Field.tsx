'use client';

import type { ComponentProps, ReactNode } from 'react';

const inputBase =
  'block w-full rounded-xl border border-[var(--color-line)] bg-white px-4 py-3 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink-3)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-soft)]';

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between">
      <label htmlFor={htmlFor} className="text-sm font-medium text-[var(--color-ink)]">
        {children}
      </label>
      {hint && <span className="text-xs text-[var(--color-ink-3)]">{hint}</span>}
    </div>
  );
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-[var(--color-warn)]">{message}</p>;
}

export function Input(props: ComponentProps<'input'>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
}

export function Textarea(props: ComponentProps<'textarea'>) {
  return (
    <textarea rows={4} {...props} className={`${inputBase} resize-y ${props.className ?? ''}`} />
  );
}

export function Select(props: ComponentProps<'select'>) {
  return (
    <select
      {...props}
      className={`${inputBase} pr-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%237b8694%22 stroke-width=%221.6%22 viewBox=%220 0 24 24%22><polyline points=%226 9 12 15 18 9%22/></svg>')] bg-[length:16px] bg-no-repeat bg-[position:right_14px_center] ${props.className ?? ''}`}
    />
  );
}

export function CheckboxRow({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white px-4 py-3 transition-colors ${
        checked
          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
          : 'border-[var(--color-line)] hover:border-[var(--color-ink-3)]'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
      />
      <span className="flex-1">
        <span className="block text-sm font-medium text-[var(--color-ink)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-[var(--color-ink-3)]">{description}</span>
        )}
      </span>
    </label>
  );
}
