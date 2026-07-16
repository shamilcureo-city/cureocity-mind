'use client';

import { useEffect, useState } from 'react';

/**
 * Landing v9.3 — the dark "during the session" copilot rail, playing a real
 * session on loop: ask-next arrives → thread queued → risk flagged →
 * assessed with one tap → the covered question retires → the arc advances.
 * Reduced-motion users see the final state, static.
 */

type Step = {
  askIn: boolean;
  threadIn: boolean;
  riskIn: boolean;
  riskArrive: boolean;
  flash: boolean;
  assessed: boolean;
  covered: boolean;
  arc: number;
};

const RESET: Step = {
  askIn: false,
  threadIn: false,
  riskIn: false,
  riskArrive: false,
  flash: false,
  assessed: false,
  covered: false,
  arc: 0,
};

const FINAL: Step = {
  askIn: true,
  threadIn: true,
  riskIn: true,
  riskArrive: false,
  flash: false,
  assessed: true,
  covered: true,
  arc: 1,
};

const LIVE_START = 23 * 60 + 41;
const NOTE_AGES = [6, 2, 4, 8, 3, 5];

export function LiveRailDemo() {
  const [s, setS] = useState<Step>(FINAL);
  const [live, setLive] = useState(LIVE_START);
  const [ageI, setAgeI] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setS(FINAL);
      return;
    }
    const liveTick = setInterval(() => setLive((t) => t + 1), 1000);
    const ageTick = setInterval(() => setAgeI((i) => i + 1), 2500);
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };
    const loop = () => {
      if (cancelled) return;
      setS(RESET);
      at(700, () => setS((p) => ({ ...p, askIn: true })));
      at(2100, () => setS((p) => ({ ...p, threadIn: true })));
      at(3200, () => setS((p) => ({ ...p, arc: 1 })));
      at(4200, () => setS((p) => ({ ...p, riskIn: true, riskArrive: true })));
      at(6400, () => setS((p) => ({ ...p, flash: true })));
      at(7000, () => setS((p) => ({ ...p, assessed: true, flash: false })));
      at(8600, () => setS((p) => ({ ...p, covered: true })));
      at(10400, () => setS((p) => ({ ...p, arc: 2 })));
      at(12600, loop);
    };
    loop();
    return () => {
      cancelled = true;
      clearInterval(liveTick);
      clearInterval(ageTick);
      timers.forEach(clearTimeout);
    };
  }, []);

  const liveLabel = `${Math.floor(live / 60)}:${String(live % 60).padStart(2, '0')}`;

  return (
    <div className="nrail">
      <div className="nrail-top">
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            fontWeight: 600,
            color: '#7DD3FC',
          }}
        >
          <span className="nlive-dot" />
          LIVE · {liveLabel}
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--night-ink2)' }}>
          note updated {NOTE_AGES[ageI % NOTE_AGES.length]}s ago
        </span>
      </div>

      <div
        className={`ncard risk${s.riskIn ? '' : ' hid'}${s.riskArrive ? ' arrive' : ''}${s.assessed ? ' settled' : ''}`}
      >
        <p className="nlab" style={{ color: '#F0A79B' }}>
          RISK WATCH · MEDIUM
        </p>
        <p style={{ fontStyle: 'italic' }}>
          “Sometimes I feel everyone would be better off without me around.”
        </p>
        <div className="nacts">
          <span className={s.flash ? 'pri flash' : 'pri'}>Assessed ✓</span>
          <span>Not relevant</span>
        </div>
      </div>

      <div className={`ncard${s.askIn ? '' : ' hid'}${s.covered ? ' settled' : ''}`}>
        <p className="nlab">ASK NEXT · CARRIED FROM S5</p>
        <p>
          <span className={s.covered ? 'covered-line' : undefined}>
            Weekend pattern — does the tightness lift away from work?
          </span>
          <span className={`ncov${s.covered ? ' on' : ''}`}>retired ✓</span>
        </p>
      </div>

      <div className={`ncard${s.threadIn ? '' : ' hid'}`}>
        <p className="nlab">THREAD NOT FOLLOWED · ×3</p>
        <p>
          Mentions of the manager conversation
          <span style={{ float: 'right', fontSize: 10.5, color: '#7DD3FC', fontWeight: 600 }}>
            Explore →
          </span>
        </p>
      </div>

      <div className="narc">
        {['Opening', 'Working', 'Closing'].map((label, i) => (
          <span key={label} className={s.arc === i ? 'on' : undefined}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
