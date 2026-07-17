import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';

const variants: Record<Variant, string> = {
  primary:
    'bg-[linear-gradient(135deg,var(--color-accent-bright),var(--color-accent))] text-white shadow-[0_10px_22px_-10px_rgba(37,99,235,0.55)] hover:brightness-105 hover:shadow-[0_12px_26px_-10px_rgba(37,99,235,0.65)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
  secondary:
    'border border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]',
  ghost: 'text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-[15px]',
  lg: 'h-13 px-7 text-base',
};

interface CommonProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: CommonProps & Omit<ComponentProps<'button'>, 'children'>) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  className = '',
  href,
  children,
}: CommonProps & { href: string }) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}
