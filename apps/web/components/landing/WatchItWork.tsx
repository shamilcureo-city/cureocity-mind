'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Landing v9.3 — "Watch it work": a video-style explainer built from DOM
 * animation. Eight scenes with subtitles, a segmented clickable progress bar,
 * play/pause (button + spacebar), ESC/backdrop close. Reduced-motion users
 * get a manual step-through instead of autoplay. This component renders both
 * the hero button and the fixed-position player overlay.
 */

const CAPTIONS = [
  'Press record on the device already in the room — no bot, nothing to install.',
  'The session flows in Manglish. Mind transcribes it, speaker by speaker.',
  'A risk phrase surfaces the moment it’s spoken. One tap — assessed, audited.',
  'Questions you haven’t asked queue quietly — and retire when you cover them.',
  'The session ends. One recording becomes five working documents — drafts, not decisions.',
  'Every suggestion cites its exact moment. Accept, edit, or reject — your call.',
  'Fingerprint-signed. Homework lands on WhatsApp. Progress you can actually see.',
  '',
];

const DURATIONS = [5000, 8000, 8500, 7000, 8500, 8500, 9000];
const SCENES = CAPTIONS.length;

export function WatchItWork() {
  const [open, setOpen] = useState(false);
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [subFx, setSubFx] = useState({ assess: false, covered: false, accept: false, sign: false });
  const reduced = useRef(false);
  const raf = useRef<number | null>(null);
  const segStart = useRef(0);
  const fills = useRef<(HTMLElement | null)[]>([]);
  const countRef = useRef<HTMLSpanElement | null>(null);
  const playingRef = useRef(false);
  const sceneRef = useRef(0);
  const subTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const clearSub = () => {
    subTimers.current.forEach(clearTimeout);
    subTimers.current = [];
  };

  const armSubFx = useCallback((i: number) => {
    clearSub();
    setSubFx({ assess: false, covered: false, accept: false, sign: false });
    const at = (ms: number, fn: () => void) => subTimers.current.push(setTimeout(fn, ms));
    if (i === 2) at(4200, () => setSubFx((p) => ({ ...p, assess: true })));
    if (i === 3) at(4200, () => setSubFx((p) => ({ ...p, covered: true })));
    if (i === 5) at(4800, () => setSubFx((p) => ({ ...p, accept: true })));
    if (i === 6) at(1500, () => setSubFx((p) => ({ ...p, sign: true })));
  }, []);

  const stopClock = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const runSeg = useCallback(() => {
    segStart.current = performance.now();
    const tick = (now: number) => {
      const i = sceneRef.current;
      if (i >= SCENES - 1 || !playingRef.current) return;
      const p = Math.min(1, (now - segStart.current) / DURATIONS[i]!);
      const fill = fills.current[i];
      if (fill) fill.style.width = `${p * 100}%`;
      if (countRef.current) {
        const base = DURATIONS.slice(0, i).reduce((a, b) => a + b, 0);
        const t = Math.floor((base + (now - segStart.current)) / 1000);
        countRef.current.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      }
      if (p >= 1) {
        goTo(i + 1);
      } else {
        raf.current = requestAnimationFrame(tick);
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      stopClock();
      sceneRef.current = i;
      setScene(i);
      fills.current.forEach((f, j) => {
        if (f) f.style.width = j < i ? '100%' : '0%';
      });
      armSubFx(i);
      if (i >= SCENES - 1) {
        playingRef.current = false;
        setPlaying(false);
        fills.current.forEach((f) => {
          if (f) f.style.width = '100%';
        });
        return;
      }
      if (playingRef.current) runSeg();
    },
    [armSubFx, runSeg],
  );

  const play = useCallback(() => {
    playingRef.current = true;
    setPlaying(true);
    goTo(sceneRef.current >= SCENES - 1 ? 0 : sceneRef.current);
  }, [goTo]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    stopClock();
  }, []);

  const openPlayer = useCallback(() => {
    setOpen(true);
    document.body.style.overflow = 'hidden';
    if (reduced.current) {
      playingRef.current = false;
      setPlaying(false);
      goTo(0);
    } else {
      play();
    }
  }, [goTo, play]);

  const closePlayer = useCallback(() => {
    setOpen(false);
    document.body.style.overflow = '';
    pause();
    clearSub();
  }, [pause]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePlayer();
      if (e.key === ' ') {
        e.preventDefault();
        if (playingRef.current) pause();
        else play();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closePlayer, pause, play]);

  useEffect(
    () => () => {
      stopClock();
      clearSub();
      document.body.style.overflow = '';
    },
    [],
  );

  const on = (i: number) => (scene === i ? 'cs on' : 'cs');

  return (
    <>
      <button
        className="btn secondary"
        style={{ padding: '15px 32px', fontSize: 16 }}
        onClick={openPlayer}
      >
        ▶&nbsp; Watch it work · 60 sec
      </button>

      <div
        className={`cx-backdrop${open ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Watch how Cureocity Mind works"
        onClick={(e) => {
          if (e.target === e.currentTarget) closePlayer();
        }}
      >
        <div className="cx-player">
          <button className="cx-close" aria-label="Close" onClick={closePlayer}>
            ✕
          </button>
          <div className="cx-stage">
            {/* S1 · record */}
            <div className={on(0)}>
              <div className="cx-center">
                <div className="cx-rec" aria-hidden>
                  <span className="cx-ring" />
                  <span className="cx-ring r2" />
                  <span className="cx-dot" />
                </div>
                <p className="cx-time mono" data-i="1">
                  4:30 PM · Arjun R. · Treatment session · CBT
                </p>
                <p className="cx-big serif" data-i="2">
                  Press record.
                </p>
              </div>
            </div>

            {/* S2 · the conversation */}
            <div className={on(1)}>
              <div className="cx-col">
                <div className="cx-bub" data-i="1">
                  <span className="mono cx-lt">ml-en · CLIENT</span>“Sleep okay aanu, pakshe office
                  il chennaal <mark>chest il oru tightness</mark>…”
                </div>
                <div className="cx-bub th" data-i="2">
                  <span className="mono cx-lt">en · THERAPIST</span>“When did you first notice the
                  tightness?”
                </div>
                <div className="cx-wave" data-i="3" aria-hidden>
                  {[45, 80, 55, 90, 50, 75, 60, 40, 85, 52, 70, 44].map((h, i) => (
                    <i key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>
            </div>

            {/* S3 · risk */}
            <div className={on(2)}>
              <div className="cx-col">
                <div className="cx-card risk" data-i="1">
                  <p className="mono cx-lab" style={{ color: '#F0A79B' }}>
                    RISK WATCH · MEDIUM
                  </p>
                  <p style={{ fontStyle: 'italic' }}>
                    “Sometimes I feel everyone would be better off without me around.”
                  </p>
                  <div className="cx-acts">
                    <span className={subFx.assess ? 'pri flash' : 'pri'}>Assessed ✓</span>
                    <span>Not relevant</span>
                  </div>
                </div>
                <p className="cx-note mono" data-i="2">
                  flagged with the verbatim quote · Indian crisis hotlines one tap away
                </p>
              </div>
            </div>

            {/* S4 · ask-next */}
            <div className={on(3)}>
              <div className="cx-col">
                <div className={`cx-card${subFx.covered ? ' covered' : ''}`} data-i="1">
                  <p className="mono cx-lab">ASK NEXT · CARRIED FROM SESSION 5</p>
                  <p>
                    <span className="cx-strike">
                      Weekend pattern — does the tightness lift away from work?
                    </span>
                    {subFx.covered && (
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: '#7DD3FC', marginLeft: 8 }}
                      >
                        retired ✓
                      </span>
                    )}
                  </p>
                </div>
                <div className="cx-card dim" data-i="2">
                  <p className="mono cx-lab">THREAD NOT FOLLOWED · ×3</p>
                  <p>Mentions of the manager conversation</p>
                </div>
              </div>
            </div>

            {/* S5 · five documents */}
            <div className={on(4)}>
              <div className="cx-fan">
                {[
                  ['01', 'Transcript', 'diarized · ml-en'],
                  ['02', 'SOAP note', 'drafted, unsigned'],
                  ['03', 'Clinical brief', 'ICD-11 candidates'],
                  ['04', 'Therapy script', 'spoken: Malayalam'],
                  ['05', 'Next-session prep', '30-second read'],
                ].map(([n, t, s], i) => (
                  <div key={n} className="cx-doc" data-i={String(i + 1)}>
                    <b className="mono">{n}</b>
                    {t}
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* S6 · you decide */}
            <div className={on(5)}>
              <div className="cx-col">
                <div className="cx-card" data-i="1">
                  <p className="mono cx-lab">AI SUGGESTS</p>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="mono cx-icd">6B00</span>
                    <b>Generalised anxiety disorder</b>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: '#7DD3FC', marginLeft: 'auto' }}
                    >
                      AI 72%
                    </span>
                  </div>
                  <p className="cx-ev" data-i="2">
                    <span className="mono" style={{ fontSize: 9.5, color: '#7DD3FC' }}>
                      EVIDENCE · 14:22
                    </span>{' '}
                    “chest il oru tightness… two weeks aayi”
                  </p>
                  <div className="cx-acts" data-i="3">
                    <span className={subFx.accept ? 'pri flash' : 'pri'}>Accept</span>
                    <span>Edit &amp; accept</span>
                    <span>Dismiss</span>
                  </div>
                </div>
              </div>
            </div>

            {/* S7 · sign & share */}
            <div className={on(6)}>
              <div className="cx-col">
                <div
                  className="cx-card"
                  data-i="1"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span style={{ fontSize: 13 }}>✓ Risk reviewed &nbsp; ✓ Review finished</span>
                  <span className="cx-acts" style={{ margin: 0 }}>
                    <span className={subFx.sign ? 'pri flash' : 'pri'}>Sign &amp; send ▸</span>
                  </span>
                </div>
                <div className="cx-bub wa" data-i="2">
                  This week’s practice: 4-7-8 breathing before bed. Your plan —{' '}
                  <b style={{ color: '#7DD3FC' }}>private portal →</b>
                </div>
                <svg viewBox="0 0 300 60" className="cx-spark" data-i="3" aria-hidden>
                  <line
                    x1="0"
                    y1="46"
                    x2="300"
                    y2="46"
                    stroke="#7DD3FC"
                    strokeDasharray="3 5"
                    strokeWidth="1"
                    opacity=".5"
                  />
                  <path
                    className="cx-sparkpath"
                    d="M12 10 L60 16 L108 22 L156 31 L204 38 L252 42 L288 44"
                    fill="none"
                    stroke="#7DD3FC"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <circle cx="288" cy="44" r="3.6" fill="#7DD3FC" />
                  <text
                    x="8"
                    y="9"
                    fontSize="9"
                    fill="#93A8C6"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    PHQ-9 18
                  </text>
                  <text
                    x="262"
                    y="58"
                    fontSize="9"
                    fill="#7DD3FC"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    → 7
                  </text>
                </svg>
              </div>
            </div>

            {/* S8 · end card */}
            <div className={on(7)}>
              <div className="cx-center">
                <p className="cx-big serif" data-i="1" style={{ fontSize: 'clamp(26px,4vw,44px)' }}>
                  Stay with your client.
                  <br />
                  <em style={{ fontStyle: 'italic', color: '#7DD3FC' }}>
                    The paperwork writes itself.
                  </em>
                </p>
                <div
                  data-i="2"
                  style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26 }}
                >
                  <Link href="/login" className="btn primary" style={{ textDecoration: 'none' }}>
                    Start free — no card
                  </Link>
                  <span className="cx-replay" onClick={play}>
                    ↺ Replay
                  </span>
                </div>
              </div>
            </div>
          </div>

          <p className="cx-cap">{CAPTIONS[scene]}</p>
          <div className="cx-ctrl">
            <button
              className="cx-play"
              aria-label={playing ? 'Pause' : 'Play'}
              onClick={() => (playing ? pause() : play())}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <div className="cx-segs">
              {CAPTIONS.map((_, i) => (
                <div
                  key={i}
                  className="cx-seg"
                  onClick={() => {
                    playingRef.current = false;
                    setPlaying(false);
                    goTo(i);
                  }}
                >
                  <i
                    ref={(el) => {
                      fills.current[i] = el;
                    }}
                  />
                </div>
              ))}
            </div>
            <span className="mono cx-count" ref={countRef}>
              0:00
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
