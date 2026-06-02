import type { ReactNode, HTMLAttributes } from 'react';

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
