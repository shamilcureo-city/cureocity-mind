'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * Landing v9.3 — "One recording. Five working documents." Tabbed paper-stack
 * demo that auto-advances with a progress bar until the visitor takes over.
 * Every document shows the product's real clinical shape.
 */

const TABS = [
  { n: '01', title: 'Transcript', sub: 'Diarized · language-tagged · code-mix native' },
  { n: '02', title: 'SOAP / intake note', sub: 'First sessions get a real intake note + MSE' },
  { n: '03', title: 'Clinical brief', sub: 'ICD-11 candidates · evidence · confidence' },
  { n: '04', title: 'Therapy script', sub: 'The exact words, in the client’s language' },
  { n: '05', title: 'Pre-session brief', sub: 'Tomorrow’s 30-second read' },
];

function Page0() {
  return (
    <>
      <p className="dhead">
        TRANSCRIPT · PASS 1 <span>asia-south1</span>
      </p>
      <div className="dt-line">
        <b className="mono" style={{ color: 'var(--amber)' }}>
          CLIENT
        </b>
        <i className="mono">ml-en</i>
        <p>
          “Sleep okay aanu, pakshe office il chennaal <mark>chest il oru tightness</mark>…”
        </p>
      </div>
      <div className="dt-line">
        <b className="mono" style={{ color: 'var(--brand)' }}>
          THERAPIST
        </b>
        <i className="mono">en</i>
        <p>“When did you first notice the tightness?”</p>
      </div>
      <div className="dt-line">
        <b className="mono" style={{ color: 'var(--amber)' }}>
          CLIENT
        </b>
        <i className="mono">ml-en</i>
        <p>“Appraisal season തുടങ്ങിയപ്പോൾ. Two weeks aayi.”</p>
      </div>
      <p className="dfoot">
        Speaker-separated, per-segment language tags — Manglish isn’t an edge case, it’s the
        default.
      </p>
    </>
  );
}

function Page1() {
  return (
    <>
      <p className="dhead">TREATMENT NOTE · PASS 2</p>
      <p className="dnh">Subjective</p>
      <p className="dnb">
        Work-linked chest tightness for two weeks, onset with appraisal season. Sleep preserved.
      </p>
      <p className="dnh">Assessment</p>
      <p className="dnb">Anxiety symptoms, work-stress pattern; GAD-7 today: 11 (moderate).</p>
      <p className="dnh">Plan</p>
      <p className="dnb">Grounding practice daily before standing meetings; review in one week.</p>
      <p className="dfoot">
        Treatment sessions get SOAP. First sessions get a proper intake note with a mental-status
        exam.
      </p>
    </>
  );
}

function Page2() {
  return (
    <>
      <p className="dhead">CLINICAL BRIEF · PASS 3</p>
      <div className="ddx">
        <span className="mono ddx-code">6B00</span>
        <div style={{ flex: 1 }}>
          <b>Generalised anxiety disorder</b>
          <div className="ddx-bar">
            <i style={{ width: '72%' }} />
          </div>
          <em>“chest il oru tightness… two weeks aayi” + 3 more signals</em>
        </div>
        <span className="ddx-conf">AI 72%</span>
      </div>
      <div className="ddx" style={{ opacity: 0.55 }}>
        <span className="mono ddx-code">6B01</span>
        <div style={{ flex: 1 }}>
          <b>Panic disorder</b>
          <div className="ddx-bar">
            <i style={{ width: '24%' }} />
          </div>
          <em>No discrete episodes — consider ruling out</em>
        </div>
        <span className="ddx-conf" style={{ background: 'var(--paper)', color: 'var(--ink3)' }}>
          AI 24%
        </span>
      </div>
      <p className="dfoot">
        Candidates, not verdicts — each cites its evidence. You accept, modify, or reject.
      </p>
    </>
  );
}

function Page3() {
  return (
    <>
      <p className="dhead">
        THERAPY SCRIPT · PASS 4 <span>spoken: Malayalam</span>
      </p>
      <div className="dstep">
        <i className="mono">1</i>
        <div>
          <b>Open</b>
          <p>
            “കണ്ണുകൾ അടച്ച്, ഒരു ദീർഘശ്വാസം എടുക്കൂ…” <em>(read aloud — the client’s language)</em>
          </p>
        </div>
      </div>
      <div className="dstep">
        <i className="mono">2</i>
        <div>
          <b>Listen for</b>
          <p>
            Shoulders dropping, breath slowing → continue. Restlessness → branch to shorter cycles.
          </p>
        </div>
      </div>
      <p className="dfoot">
        Step-by-step, with the exact words to say and branches for how the client responds.
      </p>
    </>
  );
}

function Page4() {
  return (
    <>
      <p className="dhead">
        PRE-SESSION BRIEF · PASS 5 <span>read in ~30s</span>
      </p>
      <p
        className="serif"
        style={{
          fontSize: 19,
          fontStyle: 'italic',
          color: 'var(--brand-deep)',
          lineHeight: 1.4,
          marginBottom: 14,
        }}
      >
        Arjun returns after the grounding-practice week — appraisal results landed Friday.
      </p>
      <div className="dbrief">
        <div>
          <b>LAST TIME</b>
          <p>Tightness mapped to standing meetings; GAD-7 11.</p>
        </div>
        <div>
          <b>TODAY’S FOCUS</b>
          <p>Did grounding hold through the appraisal?</p>
        </div>
        <div>
          <b>OPENING LINE</b>
          <p>
            <em>“How did the appraisal go?”</em>
          </p>
        </div>
        <div>
          <b>WATCH FOR</b>
          <p>Minimising — probe weekends vs weekdays.</p>
        </div>
      </div>
    </>
  );
}

const PAGES: ReactNode[] = [
  <Page0 key="0" />,
  <Page1 key="1" />,
  <Page2 key="2" />,
  <Page3 key="3" />,
  <Page4 key="4" />,
];

export function DocsTabs() {
  const [cur, setCur] = useState(0);
  const [pct, setPct] = useState(0);
  const touched = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;
    const t = setInterval(() => {
      if (touched.current) return;
      setPct((p) => {
        if (p + 1.8 >= 100) {
          setCur((c) => (c + 1) % PAGES.length);
          return 0;
        }
        return p + 1.8;
      });
    }, 100);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="docs-grid">
      <div className="docs-tabs rv">
        {TABS.map((t, i) => (
          <button
            key={t.n}
            className={`dtab${cur === i ? ' on' : ''}`}
            onClick={() => {
              touched.current = true;
              setCur(i);
              setPct(0);
            }}
          >
            <i>{t.n}</i>
            <div>
              <b>{t.title}</b>
              <span>{t.sub}</span>
            </div>
          </button>
        ))}
        <div className="dprog" aria-hidden>
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </div>
      <div className="docs-stage rv" style={{ ['--d' as string]: '120ms' }}>
        <div className="dpaper back b2" aria-hidden />
        <div className="dpaper back b1" aria-hidden />
        <div className="dpaper">
          <div key={cur} className="dpage on">
            {PAGES[cur]}
          </div>
        </div>
      </div>
    </div>
  );
}
