'use client';

import { useEffect, useState } from 'react';

/**
 * Landing v9.3 — "Every suggestion shows its work": clinical-brief claims
 * paired with their verbatim transcript moments. Auto-plays the pairing;
 * hovering takes over (and pauses the cycle).
 */

const PAIRS = [
  {
    claim: 'Reports work-linked chest tightness with two-week onset',
    cite: '¹',
    ts: '14:22',
    quote: '“…office il chennaal chest il oru tightness. Two weeks aayi.”',
  },
  {
    claim: 'Sleep preserved; no early-morning waking',
    cite: '²',
    ts: '18:05',
    quote: '“Sleep okay aanu — raatri prashnam illa.”',
  },
  {
    claim: 'Symptom onset coincides with appraisal season',
    cite: '³',
    ts: '21:47',
    quote: '“Appraisal season തുടങ്ങിയപ്പോൾ മുതലാണ്.”',
  },
];

export function EvidencePairs() {
  const [active, setActive] = useState<number | null>(null);
  const [hovering, setHovering] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setReduced(true);
      setActive(0);
      return;
    }
    let idx = 0;
    const t = setInterval(() => {
      setActive((prev) => {
        idx = (prev === null ? 0 : prev + 1) % PAIRS.length;
        return idx;
      });
    }, 2400);
    return () => clearInterval(t);
  }, []);

  // While hovering, the interval keeps running underneath; the last value
  // (hover-set or timer-set) simply wins.
  const shown = active;
  void hovering;

  return (
    <div
      className="ev-grid rv"
      style={{ ['--d' as string]: '220ms' }}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="ev-card">
        <p className="mono ev-tag">FROM THE CLINICAL BRIEF</p>
        {PAIRS.map((p, i) => (
          <p
            key={p.cite}
            className={`ev-claim${shown === i ? ' hot' : ''}`}
            onMouseEnter={() => {
              if (!reduced) {
                setHovering(true);
                setActive(i);
              }
            }}
          >
            {p.claim} <span className="mono ev-cite">{p.cite}</span>
          </p>
        ))}
      </div>
      <div className="ev-link" aria-hidden>
        <svg viewBox="0 0 40 40">
          <path
            d="M6 20h26M26 13l7 7-7 7"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="ev-card">
        <p className="mono ev-tag">FROM THE TRANSCRIPT · VERBATIM</p>
        {PAIRS.map((p, i) => (
          <p key={p.cite} className={`ev-quote${shown === i ? ' hot' : ''}`}>
            <span className="mono ev-ts">{p.ts}</span>
            {p.quote}
          </p>
        ))}
      </div>
    </div>
  );
}
