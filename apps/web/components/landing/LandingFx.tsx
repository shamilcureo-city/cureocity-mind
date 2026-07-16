'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Landing v9.3 — page-level effects.
 *
 * LandingFx: one IntersectionObserver that reveals every `.rv` element
 * (adds `.in`, unobserves after firing). Mounted once at the end of the page;
 * reduced-motion (and no-JS via the <noscript> fallback) shows everything.
 *
 * LangWord: the rotating language word in the code-mix section.
 *
 * Counter: a number that counts up once when scrolled into view.
 */

export function LandingFx() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.lnd .rv'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    );
    els.forEach((el) => (el.classList.contains('in') ? undefined : io.observe(el)));
    return () => io.disconnect();
  }, []);
  return null;
}

const WORDS = ['Manglish.', 'Hinglish.', 'हिन्दी.', 'മലയാളം.', 'தமிழ்.', 'বাংলা.', 'English.'];

export function LangWord() {
  const [i, setI] = useState(0);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setAnimate(true);
    const t = setInterval(() => setI((v) => (v + 1) % WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="langword-box">
      <span key={animate ? i : 'static'} className="langword serif">
        {WORDS[i]}
      </span>
    </span>
  );
}

export function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVal(to);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / 1100);
          setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [to]);

  return (
    <span ref={ref}>
      {val}
      {suffix}
    </span>
  );
}
