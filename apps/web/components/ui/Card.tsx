import type { ReactNode, HTMLAttributes } from 'react';

export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_1px_2px_rgba(10,16,31,0.04),0_10px_28px_-16px_rgba(10,16,31,0.12)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
