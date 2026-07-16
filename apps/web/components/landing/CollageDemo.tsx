'use client';

import { useEffect, useState } from 'react';

/**
 * Landing v9.3 — the hero product frame: a treatment note that types itself
 * while a recording timer ticks, then signs, then loops. The copy is the
 * product's real shape (code-mix Pass 1, PHQ-9 in the assessment).
 * Reduced-motion users get the finished state immediately.
 */

const LINES: { id: string; tag: string; text: string }[] = [
  { id: 's', tag: 'S', text: 'Two weeks of poor sleep; exam stress. Worst around 2 a.m.' },
  { id: 'o', tag: 'O', text: 'Tearful early, settled by mid-point. Speech normal.' },
  { id: 'a', tag: 'A', text: 'Acute stress reaction, mild–moderate. PHQ-9 today: 11.' },
  { id: 'p', tag: 'P', text: 'Sleep-hygiene plan + 4-7-8 breathing nightly. Review in 1 week.' },
];

const REC_START = 47 * 60 + 12;
const TOTAL = LINES.reduce((n, l) => n + l.text.length, 0);

type Phase = 'recording' | 'drafting' | 'signed';

export function CollageDemo() {
  const [phase, setPhase] = useState<Phase>('recording');
  const [typed, setTyped] = useState(0);
  const [rec, setRec] = useState(REC_START);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setReduced(true);
      setPhase('signed');
      setTyped(TOTAL);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let typerI: ReturnType<typeof setInterval> | null = null;
    const tick = setInterval(() => setRec((r) => r + 1), 1000);

    const recording = () => {
      if (cancelled) return;
      setPhase('recording');
      setTyped(0);
      setRec(REC_START);
      timer = setTimeout(drafting, 2600);
    };
    const drafting = () => {
      if (cancelled) return;
      setPhase('drafting');
      let n = 0;
      typerI = setInterval(() => {
        n += 2;
        if (n >= TOTAL) {
          if (typerI) clearInterval(typerI);
          setTyped(TOTAL);
          timer = setTimeout(signed, 600);
        } else {
          setTyped(n);
        }
      }, 26);
    };
    const signed = () => {
      if (cancelled) return;
      setPhase('signed');
      timer = setTimeout(recording, 5200);
    };
    recording();
    return () => {
      cancelled = true;
      clearInterval(tick);
      if (timer) clearTimeout(timer);
      if (typerI) clearInterval(typerI);
    };
  }, []);

  let budget = typed;
  const lines = LINES.map((l) => {
    const take = Math.max(0, Math.min(l.text.length, budget));
    budget -= take;
    return { ...l, shown: l.text.slice(0, take), active: take > 0 && take < l.text.length };
  });

  const recLabel = `${Math.floor(rec / 60)}:${String(rec % 60).padStart(2, '0')}`;
  const chip =
    phase === 'recording'
      ? `● recording ${recLabel}`
      : phase === 'drafting'
        ? 'drafting…'
        : '✓ signed · biometric';

  return (
    <div className="collage-main">
      <div className="cm-bar" aria-hidden>
        <i />
        <i />
        <i />
        <span className="cm-url">mind.cureocity.in/app · session 6 · Arjun R.</span>
      </div>
      <div className="cm-body">
        <div className="cm-note">
          <h4>
            Treatment note — drafting <span className="chip">{chip}</span>
          </h4>
          <div className="cm-lines">
            {lines.map((l) => (
              <div key={l.id} className="cm-line">
                <span className="cm-tag">{l.tag}</span>
                <p>
                  {l.shown}
                  {!reduced && l.active && <span className="caret" />}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="cm-side">
          <h5>Copilot</h5>
          <div className="cm-item">
            <b>Ask next</b>Weekend pattern — does the tightness lift away from work?
          </div>
          <div className="cm-item">
            <b>Session arc</b>Working phase · 23 min · homework unset
          </div>
          <div className="cm-item" style={{ borderColor: '#CBD6E5', background: '#F1F5F9' }}>
            <b style={{ color: '#2F416B' }}>Carried from S5</b>Manager conversation follow-up
          </div>
        </div>
      </div>
    </div>
  );
}
