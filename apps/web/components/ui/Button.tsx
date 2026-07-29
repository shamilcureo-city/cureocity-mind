import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

/**
 * v10 "glass aurora" controls.
 *
 * primary   — pressed-metal ink: a top light-line, an inner bottom shade and
 *             a deep cast, so the control reads as a physical object. It
 *             depresses 1px on :active (the shadow collapses with it).
 * secondary — frosted glass on the aurora, with the same bright top rim as
 *             the cards it sits among.
 * ghost     — flat, for tertiary actions inside dense rows.
 *
 * Depth recipes live in globals.css (--sh-3d / --sh-raise) so the app and the
 * landing page stay one system.
 */
const base =
  'u-press inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:border-transparent disabled:bg-[var(--color-line-soft)] disabled:bg-none disabled:text-[var(--color-ink-3)] disabled:shadow-none disabled:translate-y-0 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]';

const variants: Record<Variant, string> = {
  primary:
    'u-ink shadow-[var(--sh-3d)] hover:shadow-[var(--sh-3d-hover)] active:shadow-[var(--sh-3d-press)]',
  secondary:
    'border border-white/90 bg-[linear-gradient(165deg,rgba(255,255,255,0.95),rgba(255,255,255,0.62))] text-[var(--color-ink)] shadow-[var(--sh-raise)] backdrop-blur-md hover:bg-white hover:shadow-[0_16px_32px_-16px_rgba(35,45,95,0.45),inset_0_1px_0_#fff] active:shadow-[inset_0_2px_4px_rgba(35,45,95,0.18)]',
  ghost:
    'text-[var(--color-ink)] hover:bg-white/70 hover:shadow-[var(--sh-raise)] active:translate-y-0',
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
