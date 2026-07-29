import type { ReactNode, HTMLAttributes } from 'react';

/**
 * v10 "glass aurora" surface — a frosted panel floating on the app wash,
 * with the bright top rim that reads as light catching an edge. The fill
 * stays high-opacity on purpose: clinical tables and note text have to
 * stay crisp, so this is glass, not gauze. Recipe in globals.css (.u-glass).
 */
export function Card({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`u-glass rounded-2xl ${className}`} {...rest}>
      {children}
    </div>
  );
}
