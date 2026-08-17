import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';
import { BRAND } from '@/lib/brand';

type LogoSize = 'sm' | 'md' | 'lg';

const sizes: Record<LogoSize, { mark: string; text: string; gap: string }> = {
  sm: { mark: 'h-6 w-10', text: 'text-sm', gap: 'gap-2.5' },
  md: { mark: 'h-8 w-[3.25rem]', text: 'text-base', gap: 'gap-3' },
  lg: { mark: 'h-11 w-[4.5rem]', text: 'text-xl', gap: 'gap-4' },
};

export function OrbitMark({ className = '', ...props }: ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 160 88" fill="none" aria-hidden="true" className={className} {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M80 8C35.82 8 0 24.12 0 44s35.82 36 80 36 80-16.12 80-36S124.18 8 80 8Zm0 14c30.93 0 56 9.85 56 22S110.93 66 80 66 24 56.15 24 44s25.07-22 56-22Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

interface OrbitLogoProps {
  size?: LogoSize;
  className?: string;
  markOnly?: boolean;
  href?: string;
  inverse?: boolean;
}

export function OrbitLogo({
  size = 'md',
  className = '',
  markOnly = false,
  href,
  inverse = false,
}: OrbitLogoProps) {
  const scale = sizes[size];
  const content = (
    <>
      <OrbitMark className={`${scale.mark} shrink-0`} />
      {!markOnly && (
        <span
          className={`${scale.text} font-sans font-medium uppercase leading-none tracking-[0.34em]`}
        >
          {BRAND.product}
        </span>
      )}
      <span className="sr-only">{BRAND.fullName}</span>
    </>
  );
  const classes = `inline-flex items-center ${scale.gap} ${inverse ? 'text-white' : 'text-[var(--color-ink)]'} ${className}`;

  return href ? (
    <Link href={href} className={classes} aria-label={BRAND.fullName}>
      {content}
    </Link>
  ) : (
    <span className={classes} aria-label={BRAND.fullName}>
      {content}
    </span>
  );
}
