'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms, applied as a CSS transition-delay. */
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'span';
}

/**
 * Sprint 34 — landing-page scroll reveal.
 *
 * Wraps a block in `[data-lp-reveal]` (hidden via globals.css) and adds
 * `.lp-in` once it enters the viewport. One observer per instance is
 * fine at landing-page scale (~20 nodes); each unobserves after firing
 * so re-scrolling never re-triggers.
 *
 * Children that need their own staged animation (sparkline, stage rail,
 * chat bubbles) key off the same `.lp-in` on this wrapper rather than
 * observing separately — one trigger, many cascades.
 *
 * Reduced-motion users get content instantly via the CSS override; the
 * observer still runs but the class change is a no-op visually. No-JS
 * visitors are covered by a <noscript> style in the page.
 */
export function Reveal({ children, className = '', delay = 0, as = 'div' }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Runtime renders the requested tag; typing it as 'div' keeps the ref
  // simple — every allowed tag is an HTMLElement and we only call
  // classList on it.
  const Tag = as as 'div';

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      node.classList.add('lp-in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('lp-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  const style = delay > 0 ? ({ '--lp-delay': `${delay}ms` } as CSSProperties) : undefined;

  return (
    <Tag ref={ref} data-lp-reveal="" className={className} style={style}>
      {children}
    </Tag>
  );
}
