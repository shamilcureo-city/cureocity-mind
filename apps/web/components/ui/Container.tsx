import type { ReactNode } from 'react';

export function Container({
  children,
  className = '',
  as: As = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'header' | 'footer' | 'main' | 'nav';
}) {
  return <As className={`mx-auto w-full max-w-[1180px] px-6 sm:px-8 ${className}`}>{children}</As>;
}
