import Link from 'next/link';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import './landing.css';
import { CollageDemo } from '@/components/landing/CollageDemo';
import { DocsTabs } from '@/components/landing/DocsTabs';
import { EvidencePairs } from '@/components/landing/EvidencePairs';
import { Counter, LandingFx, LangWord } from '@/components/landing/LandingFx';
import { LandingNav } from '@/components/landing/LandingNav';
import { LiveRailDemo } from '@/components/landing/LiveRailDemo';
import { WatchItWork } from '@/components/landing/WatchItWork';
import {
  BreathSigArt,
  FcSparkArt,
  HowPathArt,
  LangArrowArt,
  MeasuresSparkArt,
  OutcomesChartArt,
  ResidencyPinArt,
  RoomArt,
  TimelineArt,
} from '@/components/landing/landing-art';

/**
 * The marketing landing page — v9.3 "neon blue glass" redesign.
 *
 * Statically rendered; auth is never resolved here (the nav's CTAs go to
 * /login, whose guards handle the rest). All styling lives in ./landing.css,
 * scoped under `.lnd` so the shared lp-* layer (still used by /for-doctors)
 * and the app tokens are untouched. Client interactivity is confined to
 * islands in components/landing/: the nav burger, the typing hero demo, the
 * live-rail loop, the evidence pairing, the documents tabs, the counters,
 * the reveal observer, and the "Watch it work" cinematic player.
 *
 * The honesty policy holds: every claim below is a shipped product fact —
 * no invented stats, no testimonials; the WhatsApp vignette is labelled an
 * illustration and the pilot section says plainly that the product is new.
 */

export const metadata: Metadata = {
  title: 'Cureocity Mind — the clinical copilot for Indian therapists',
  description:
    'Press record — a clinical copilot listens alongside you: flagging risk as it’s spoken, queueing the questions you haven’t asked, and turning the session into a SOAP note, ICD-11 clinical brief, therapy script, and next-session prep. In English, हिन्दी, മലയാളം, or the code-mix your clients actually speak.',
};

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

export default function LandingPage() {
  return (
    <main className="lnd">
      {/* Reveal fallback for no-JS visitors. */}
      <noscript>
        <style>{`.lnd .rv{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <div className="annc">
        Now piloting with the first therapist cohort in Kerala —{' '}
        <b>free through the pilot, no card →</b>
      </div>

      <LandingNav />
      <Hero />
      <Lattice />
      <HowItWorks />
      <LiveSection />
      <Evidence />
      <Documents />
      <InsideTheApp />
      <CodeMix />
      <Outcomes />
      <Privacy />
      <BetweenSessions />
      <TheRoom />
      <Pilot />
      <Faq />
      <FinalCta />
      <Footer />
      <LandingFx />
    </main>
  );
}

/* ============================================================================
   Hero + collage + counters
   ========================================================================== */

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 13l4 4 10-11" />
    </svg>
  );
}

function Hero() {
  return (
    <header className="hero grain">
      <div className="hero-wash" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div className="wrap">
        <span className="hero-badge rv in">
          <span className="dot" /> Built by the Cureocity health-tech team · Kozhikode
        </span>
        <h1 className="h1 rv in">
          Stay with your client.
          <br />
          The paperwork{' '}
          <span className="hl-swipe go">
            <em>writes itself.</em>
          </span>
        </h1>
        <p className="hero-sub rv in" style={d(120)}>
          Press record — and a clinical copilot listens alongside you: flagging risk the moment it’s
          spoken, queueing the questions you haven’t asked, and turning the session into the SOAP
          note, ICD-11 brief, therapy script, and tomorrow’s prep. In English, हिन्दी, മലയാളം, or
          the code-mix your clients actually speak.
        </p>
        <div className="hero-ctas rv in" style={d(220)}>
          <Link
            href="/login"
            className="btn primary"
            style={{ padding: '15px 32px', fontSize: 16, textDecoration: 'none' }}
          >
            Start free — no card
          </Link>
          <WatchItWork />
        </div>
        <div className="hero-neg rv in" style={d(320)}>
          <span>
            <Check />
            No bot joins anything
          </span>
          <span>
            <Check />
            No audio kept after the note
          </span>
          <span>
            <Check />
            Nothing final without your sign-off
          </span>
        </div>
      </div>

      {/* floating product collage */}
      <div className="collage rv">
        <span className="anno an-1 hand" aria-hidden>
          the note writes itself, live
          <svg viewBox="0 0 52 34">
            <path d="M6 4 C14 20 30 28 46 26 M40 20 l7 6 -9 4" />
          </svg>
        </span>
        <span className="anno an-2 hand" style={{ '--rot': '2deg' } as CSSProperties} aria-hidden>
          <svg viewBox="0 0 52 34" style={{ marginLeft: 'auto', transform: 'rotate(200deg)' }}>
            <path d="M6 4 C14 20 30 28 46 26 M40 20 l7 6 -9 4" />
          </svg>
          it caught this — you decide
        </span>

        <CollageDemo />

        <div className="fcard fc-live">
          <h6>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#E25C4A',
                display: 'inline-block',
              }}
            />
            Live transcript · diarized
          </h6>
          <div className="wave" aria-hidden>
            {[40, 75, 55, 90, 48, 80, 60, 38, 70, 52].map((h, i) => (
              <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
          <p>
            <span className="lt">ml-en</span>“Sleep okay aanu, pakshe office il chennaal chest il
            oru tightness…”
          </p>
        </div>

        <div className="fcard fc-risk">
          <h6>Risk watch · you decide</h6>
          <p>“Sometimes I feel everyone would be better off without me.”</p>
          <div className="acts">
            <span>Assessed ✓</span>
            <span>Not relevant</span>
          </div>
        </div>

        <div className="fcard fc-chart">
          <h6>PHQ-9 · reliable change</h6>
          <div className="vd">
            <b>18 → 7</b>
            <span className="cap">−61% · improving</span>
          </div>
          <FcSparkArt />
        </div>

        <div className="fcard fc-wa">
          <h6>Shared to WhatsApp · consented</h6>
          <div className="bub">
            This week’s practice: 4-7-8 breathing before bed. Full plan here —
            <span className="link">🔗 private portal</span>
          </div>
        </div>
      </div>

      {/* counters */}
      <div className="stats">
        <div className="stat rv">
          <b>
            <Counter to={5} />
          </b>
          <span className="cap">
            working documents
            <br />
            from one recording
          </span>
        </div>
        <div className="stat rv" style={d(90)}>
          <b>
            <Counter to={12} />+
          </b>
          <span className="cap">
            languages &amp; code-mixes —<br />
            Manglish included
          </span>
        </div>
        <div className="stat rv" style={d(180)}>
          <b>
            <Counter to={30} />
            -day
          </b>
          <span className="cap">
            audio auto-delete,
            <br />
            transcribed in Mumbai
          </span>
        </div>
        <div className="stat rv" style={d(270)}>
          <b>1 tap</b>
          <span className="cap">
            to share homework
            <br />
            on WhatsApp
          </span>
        </div>
      </div>
    </header>
  );
}

const LATTICE_CHIPS: ReactNode[] = [
  <>
    Speaks <b>ICD-11</b>
  </>,
  <>
    Scores <b>PHQ-9</b> &amp; <b>GAD-7</b>
  </>,
  <>
    <b>DPDP</b>-ready by design
  </>,
  <>
    Knows <b>SOAP</b> from an <b>intake note</b>
  </>,
  <>
    Shares over <b>WhatsApp</b>
  </>,
  <>
    Signs with your <b>fingerprint</b>
  </>,
  <>
    Audio stays in <b>India</b>
  </>,
  <>
    Handles <b>Manglish</b> &amp; <b>Hinglish</b>
  </>,
];

function Lattice() {
  return (
    <div className="lattice">
      <div className="lat-track">
        {[0, 1].map((dup) =>
          LATTICE_CHIPS.map((chip, i) => (
            <span key={`${dup}-${i}`} className="lat-chip" aria-hidden={dup === 1}>
              {chip}
            </span>
          )),
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   How it works
   ========================================================================== */

function HowItWorks() {
  return (
    <section className="sect" id="how">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
          How it works
        </span>
        <h2 className="big rv" style={d(80)}>
          Three moves. <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>Zero typing.</em>
        </h2>
      </div>
      <div className="wrap how-grid">
        <HowPathArt />
        <div className="how-card rv">
          <div className="how-gfx" aria-hidden>
            <span className="mic-ring" />
            <span className="mic-ring r2" />
            <span className="how-ic">
              <svg viewBox="0 0 24 24">
                <rect x="9" y="3.5" width="6" height="11" rx="3" />
                <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
              </svg>
            </span>
          </div>
          <span className="hand how-hand" style={{ '--rot': '-3deg' } as CSSProperties}>
            the phone already in your room
          </span>
          <h3 className="serif">Record</h3>
          <p>
            Tap record — in the room or online. You get a diarized transcript, tagged
            speaker-by-speaker and language-by-language, mid-sentence switches included.
          </p>
        </div>
        <div className="how-card rv" style={d(140)}>
          <div className="how-gfx" aria-hidden>
            <span className="how-stack s1" />
            <span className="how-stack s2" />
            <span className="how-ic">
              <svg viewBox="0 0 24 24">
                <path d="M6 3.5h9l4 4v13H6zM14.5 3.5v4.5h4.5M9.5 13h6M9.5 16.5h4" />
              </svg>
            </span>
          </div>
          <span className="hand how-hand" style={{ '--rot': '2deg' } as CSSProperties}>
            drafts arrive while you stretch
          </span>
          <h3 className="serif">Review</h3>
          <p>
            The note, the ICD-11 brief, the plan — each one a draft with its evidence attached.
            Accept, edit, or reject every suggestion; each call is tracked.
          </p>
        </div>
        <div className="how-card rv" style={d(280)}>
          <div className="how-gfx" aria-hidden>
            <span className="how-send" />
            <span className="how-ic">
              <svg viewBox="0 0 24 24">
                <path d="M21 3.5 3.5 10.5l6.5 3 3 6.5zM21 3.5 10 13.5" />
              </svg>
            </span>
          </div>
          <span className="hand how-hand" style={{ '--rot': '-2deg' } as CSSProperties}>
            fingerprint, then WhatsApp
          </span>
          <h3 className="serif">Share</h3>
          <p>
            Sign with your fingerprint, then send homework, the plan, or a progress report over
            WhatsApp, email, or a private portal link — consent-gated, audited.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   During the session (dark set piece)
   ========================================================================== */

function LiveSection() {
  return (
    <section className="night-sect grain" id="live">
      <div className="wrap night-in">
        <div className="night-copy">
          <span className="eyebrow" style={{ color: '#7DD3FC' }}>
            During the session
          </span>
          <h2 className="big" style={{ color: 'var(--night-ink)' }}>
            A quiet second voice
            <br />
            that <em style={{ fontStyle: 'italic', color: '#7DD3FC' }}>never interrupts.</em>
          </h2>
          <p className="sub" style={{ color: 'var(--night-ink2)' }}>
            Go live and a copilot listens alongside you. Risk phrases surface the moment they’re
            spoken. Unexplored threads queue quietly. The note assembles itself in the margin —
            while your eyes stay on the person in front of you.
          </p>
          <div className="night-feats">
            <div>
              <span className="nf-ic" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M12 3l8 4v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V7z" />
                  <path d="M9 12l2 2 4-4.5" />
                </svg>
              </span>
              <div>
                <b>Risk watch</b>
                <p>
                  Safety cues flagged with the verbatim quote, severity, and Indian crisis hotlines
                  one tap away.
                </p>
              </div>
            </div>
            <div>
              <span className="nf-ic" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M12 4a8 8 0 0 1 8 8c0 1.8-.6 3.4-1.6 4.8L20 21l-4.4-1.4A8 8 0 1 1 12 4z" />
                  <path d="M8.5 10.5h7M8.5 14h4.5" />
                </svg>
              </span>
              <div>
                <b>Ask-next</b>
                <p>
                  Questions you haven’t asked — carried from last session, retired the moment you
                  cover them.
                </p>
              </div>
            </div>
            <div>
              <span className="nf-ic" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7v5l3.5 2.5" />
                </svg>
              </span>
              <div>
                <b>Session arc</b>
                <p>
                  A gentle pacing bar. Ten minutes left and the homework unset? It mentions it —
                  once.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="night-stage">
          <LiveRailDemo />
          <div className="fcard n-fc" style={{ '--rot': '2.5deg', '--dur': '7s' } as CSSProperties}>
            <h6 style={{ color: 'var(--ink3)' }}>Talk balance</h6>
            <div
              style={{
                display: 'flex',
                height: 8,
                borderRadius: 99,
                overflow: 'hidden',
                width: 180,
              }}
              aria-hidden
            >
              <i style={{ width: '68%', background: '#1F41A3' }} />
              <i style={{ width: '32%', background: '#D9E1ED' }} />
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--ink3)', marginTop: 6 }}>
              Client 68% · You 32% — good listening
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Copilot evidence
   ========================================================================== */

function Evidence() {
  return (
    <section className="sect" id="evidence">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
          Why you can trust the copilot
        </span>
        <h2 className="big rv" style={d(80)}>
          Every suggestion
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>shows its work.</em>
        </h2>
        <p
          className="sub rv"
          style={{ ...d(160), marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}
        >
          Nothing reaches the record on vibes. Every diagnosis candidate, risk flag, and plan line
          cites the exact moment in the session it came from —{' '}
          <b>hover a claim to see its evidence.</b> A suggestion that can’t cite a real utterance is
          discarded before you ever see it.
        </p>
      </div>
      <div className="wrap">
        <EvidencePairs />
      </div>
      <p
        className="rv"
        style={{
          ...d(280),
          textAlign: 'center',
          fontSize: 13,
          color: 'var(--ink3)',
          marginTop: 22,
        }}
      >
        This is enforced in the pipeline — the citation gate — not just promised on this page.
      </p>
    </section>
  );
}

/* ============================================================================
   Five documents
   ========================================================================== */

function Documents() {
  return (
    <section
      className="sect"
      id="docs"
      style={{ background: 'var(--paper)', borderBlock: '1px solid var(--line)' }}
    >
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
          After each session
        </span>
        <h2 className="big rv" style={d(80)}>
          One recording.
          <br />
          <span className="hl-swipe">
            <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>Five working documents.</em>
          </span>
        </h2>
        <p
          className="sub rv"
          style={{ ...d(160), marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}
        >
          Every artefact is a draft until you sign it. Confirmed diagnoses and plans accumulate on
          the client record — the AI sees the whole arc, not one session at a time.
        </p>
      </div>
      <div className="wrap">
        <DocsTabs />
      </div>
    </section>
  );
}

/* ============================================================================
   Inside the app — product bento
   ========================================================================== */

function InsideTheApp() {
  return (
    <section className="sect" id="inside">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
          Inside the app
        </span>
        <h2 className="big rv" style={d(80)}>
          The whole practice.
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>One calm surface.</em>
        </h2>
        <p
          className="sub rv"
          style={{ ...d(160), marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}
        >
          Not just notes — your day, every client’s arc, and every AI suggestion waiting for your
          call. This is the actual product.
        </p>
      </div>
      <div className="wrap ba-grid">
        <div className="ba-cell ba-wide rv">
          <div className="ba-head">
            <span className="mono ba-tag">CLIENT JOURNEY</span>
            <span className="chip acc">Reliable improvement</span>
          </div>
          <TimelineArt />
          <p className="ba-cap">
            Every client gets an arc — sessions, scores, and your decisions on one line, intake to
            discharge.
          </p>
        </div>

        <div className="ba-cell rv" style={d(90)}>
          <div className="ba-head">
            <span className="mono ba-tag">TODAY</span>
          </div>
          <div className="ba-app">
            <p className="serif" style={{ fontSize: 17, fontWeight: 620, letterSpacing: '-.01em' }}>
              Good afternoon, Meera.
            </p>
            <p className="mono" style={{ fontSize: 9, color: 'var(--ink3)', marginTop: 2 }}>
              TUE 15 JUL · 2 SESSIONS LEFT · 1 TO SIGN
            </p>
            <div className="ba-next">
              <span className="ba-av serif">A</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 12.5 }}>Arjun Rao</b>
                <p style={{ fontSize: 9.5, color: 'var(--ink3)' }}>
                  <span className="mono">4:30</span> · Treatment · CBT ·{' '}
                  <span style={{ color: 'var(--brand)', fontWeight: 600 }}>in 25 min</span>
                </p>
              </div>
              <span className="ba-start">● Start</span>
            </div>
            <div className="ba-row">
              <span className="mono">2:00</span>
              <b>Kavya Nair</b>
              <span className="ba-ok">✓ signed</span>
            </div>
            <div className="ba-row">
              <span className="mono">3:00</span>
              <b>Rohit Menon</b>
              <span className="ba-sign">Sign ▸</span>
            </div>
            <div className="ba-row dim">
              <span className="mono">6:00</span>
              <b>Sana Iqbal</b>
              <span>intake</span>
            </div>
          </div>
          <p className="ba-cap">Your day, triaged — one tap from prep to recording.</p>
        </div>

        <div className="ba-cell rv" style={d(60)}>
          <div className="ba-head">
            <span className="mono ba-tag">AI COPILOT · YOU DECIDE</span>
          </div>
          <div className="ba-app">
            <p className="mono" style={{ fontSize: 8.5, color: '#2F416B', letterSpacing: '.1em' }}>
              AI SUGGESTS
            </p>
            <div className="ba-dx">
              <span className="mono ba-icd">6B00</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 11.5 }}>Generalised anxiety disorder</b>
                <div className="ba-conf">
                  <i style={{ width: '72%' }} />
                </div>
                <p style={{ fontSize: 8.5, color: 'var(--ink3)' }}>
                  cites 4 moments from the transcript
                </p>
              </div>
            </div>
            <div className="ba-acts">
              <span className="pri">Accept</span>
              <span>Edit &amp; accept</span>
              <span>Dismiss</span>
            </div>
            <p
              className="mono"
              style={{ fontSize: 8.5, color: 'var(--ink3)', letterSpacing: '.1em', marginTop: 12 }}
            >
              YOUR RECORD — DECIDED
            </p>
            <div className="ba-rec">
              <span>✓</span>Plan v2 · 3 goals · 2 achieved
            </div>
            <div className="ba-rec">
              <span>✓</span>Safety reviewed · no flags
            </div>
          </div>
          <p className="ba-cap">
            Suggestions wait in their own lane — nothing joins the record until you accept it.
          </p>
        </div>

        <div className="ba-cell rv" style={d(120)}>
          <div className="ba-head">
            <span className="mono ba-tag">MEASURES</span>
            <span className="chip warn" style={{ fontSize: 9, padding: '2px 8px' }}>
              GAD-7 due
            </span>
          </div>
          <div className="ba-app">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <b className="mono" style={{ fontSize: 19 }}>
                18 → 7
              </b>
              <span style={{ fontSize: 9.5, color: 'var(--brand)', fontWeight: 600 }}>
                moderately severe → mild
              </span>
            </div>
            <MeasuresSparkArt />
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <span className="ba-start" style={{ background: 'var(--brand)' }}>
                Send check-in ▸
              </span>
              <span className="ba-ghost">In-session</span>
            </div>
          </div>
          <p className="ba-cap">
            PHQ-9 and GAD-7 in the flow of the session — verdicts from the literature.
          </p>
        </div>

        <div className="ba-cell rv" style={d(150)}>
          <div className="ba-head">
            <span className="mono ba-tag">SIGN &amp; SEND</span>
          </div>
          <div className="ba-app">
            <p
              className="mono"
              style={{ fontSize: 8.5, color: 'var(--brand)', letterSpacing: '.1em' }}
            >
              SUBJECTIVE
            </p>
            <p style={{ fontSize: 10.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
              Appraisal conversation happened Thursday — “went better than the dread deserved.”
              Tightness twice, resolved with grounding…
            </p>
            <p
              className="mono"
              style={{ fontSize: 8.5, color: 'var(--brand)', letterSpacing: '.1em', marginTop: 8 }}
            >
              PLAN
            </p>
            <p style={{ fontSize: 10.5, lineHeight: 1.6, color: 'var(--ink2)' }}>
              Continue grounding; thought-record for the perfectionism loop; re-measure GAD-7.
            </p>
            <div className="ba-signbar">
              <span style={{ fontSize: 8.5, color: 'var(--ink2)' }}>
                ✓ Risk reviewed &nbsp;✓ Review finished
              </span>
              <span className="ba-start" style={{ background: 'var(--brand)' }}>
                Sign &amp; send ▸
              </span>
            </div>
          </div>
          <p className="ba-cap">
            One bar answers “am I done?” — fingerprint-signed, shared in a tap.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Code-mix
   ========================================================================== */

function CodeMix() {
  return (
    <section className="sect" id="lang">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
          Code-mix first
        </span>
        <h2 className="big rv" style={d(80)}>
          Therapy in India happens in
          <br />
          <LangWord />
        </h2>
        <p className="sub rv" style={{ ...d(160), margin: '22px auto 0', textAlign: 'center' }}>
          Not “English with errors” — a language of its own. Pass 1 tags every segment, mid-sentence
          switches included; your documents come out in your language, the client’s homework in
          theirs.
        </p>
        <div className="lang-demo rv" style={d(240)}>
          <div className="lang-chip">
            <span className="mono lt2">hi-en</span>“Raat ko neend nahi aati,{' '}
            <mark>presentation se pehle</mark> heartbeat badh jaata hai”
          </div>
          <div className="lang-arrow" aria-hidden>
            <LangArrowArt />
          </div>
          <div className="lang-chip out">
            <b>S —</b> Sleep-onset difficulty; anticipatory palpitations before presentations.
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Outcomes
   ========================================================================== */

function Outcomes() {
  return (
    <section
      className="sect grain"
      id="outcomes"
      style={{ background: 'var(--paper)', borderBlock: '1px solid var(--line)' }}
    >
      <div className="wrap out-grid">
        <div>
          <span className="eyebrow rv">Measurement-based care</span>
          <h2 className="big rv" style={d(80)}>
            Therapy you can
            <br />
            <span className="hl-swipe">
              <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>see</em>
            </span>{' '}
            working.
          </h2>
          <p className="sub rv" style={d(160)}>
            PHQ-9 and GAD-7 live in the flow of the session — and the verdict is deterministic.
            Reliable-change thresholds come straight from the validation literature, never from a
            model’s opinion.
          </p>
          <div className="out-pts rv" style={d(240)}>
            <div>
              <b>A journey, not a pile of notes.</b> Every client gets an arc — intake to discharge
              — with a next-best-action so nothing drifts.
            </div>
            <div>
              <b>Honest verdicts.</b> Plateaus and deteriorations are flagged just as plainly as
              wins.
            </div>
            <div>
              <b>A report your client can read.</b> One tap turns the arc into plain language —
              shareable on WhatsApp.
            </div>
          </div>
        </div>
        <div className="out-stage rv" style={d(150)}>
          <span
            className="hand"
            style={{
              position: 'absolute',
              right: '8%',
              top: -34,
              fontSize: 21,
              color: 'var(--amber)',
              transform: 'rotate(3deg)',
              zIndex: 3,
            }}
            aria-hidden
          >
            from the literature — not vibes ↓
          </span>
          <div className="out-card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <b style={{ fontSize: 15 }}>PHQ-9 across treatment</b>
                <br />
                <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
                  Eight sessions · one client
                </span>
              </div>
              <span className="out-verdict">✓ Reliable improvement · remission</span>
            </div>
            <OutcomesChartArt />
            <div className="out-stages">
              <span className="done">Intake</span>
              <span className="done">Assessment</span>
              <span className="done">Treatment</span>
              <span className="on">Review</span>
              <span>Discharge</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Privacy / DPDP
   ========================================================================== */

function Privacy() {
  return (
    <section className="sect" id="privacy">
      <div className="wrap priv-grid">
        <div className="priv-map rv">
          <div className="india-card">
            <ResidencyPinArt />
            <div className="india-note">
              <p
                className="mono"
                style={{ fontSize: 10.5, color: 'var(--brand)', letterSpacing: '.1em' }}
              >
                AUDIO RESIDENCY
              </p>
              <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink2)', marginTop: 6 }}>
                Session audio is transcribed on Vertex AI in Mumbai and{' '}
                <b style={{ color: 'var(--ink)' }}>never stored beyond 30 days</b>. Structuring runs
                on the transcript under your client’s recorded consent.
              </p>
            </div>
          </div>
        </div>
        <div>
          <span className="eyebrow rv">Your data · DPDP</span>
          <h2 className="big rv" style={d(80)}>
            Straight answers
            <br />
            about the recording.
          </h2>
          <p className="sub rv" style={d(140)}>
            Built like it’s health data — because it is. No fine print contradicts any of this:
          </p>
          <div className="priv-list rv" style={d(220)}>
            {[
              [
                '01',
                'Audio is deleted on schedule.',
                'Transcription happens in real time; a 30-day purge is enforced by a cron, not a policy PDF.',
              ],
              [
                '02',
                'Encrypted per practice.',
                'Client PII is envelope-encrypted with a key unique to your practice — AES-256-GCM, never shared across tenants.',
              ],
              [
                '03',
                'Never used for training.',
                'Your sessions produce your documents. They don’t train our models or anyone else’s.',
              ],
              [
                '04',
                'Everything audited, you sign everything.',
                'Append-only audit log built for DPDP data-subject requests; notes sign with your fingerprint, cryptographically verified.',
              ],
            ].map(([n, title, body]) => (
              <div key={n}>
                <i>{n}</i>
                <div>
                  <b>{title}</b>
                  <p>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Between sessions
   ========================================================================== */

function BetweenSessions() {
  return (
    <section
      className="sect grain"
      id="between"
      style={{
        background: 'linear-gradient(180deg,#F2F5F9 0%,#fff 100%)',
        borderTop: '1px solid var(--line)',
      }}
    >
      <div className="wrap wa-grid">
        <div>
          <span className="eyebrow rv">Between sessions</span>
          <h2 className="big rv" style={d(80)}>
            Therapy doesn’t end
            <br />
            <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>at the door.</em>
          </h2>
          <p className="sub rv" style={d(160)}>
            Homework, plans, reflection prompts, and progress reports go out over WhatsApp, email,
            or a private portal link — consent-gated, in your client’s preferred language, every
            share audited.
          </p>
          <p
            className="rv"
            style={{
              ...d(220),
              fontSize: 15,
              color: 'var(--ink2)',
              maxWidth: '48ch',
              lineHeight: 1.7,
            }}
          >
            The portal is a clean page, not an app to install. Your client opens the link, reads the
            plan, fills the two-minute check-in. You see it before the next session.
          </p>
        </div>
        <div className="rv phone-wrap" style={d(140)}>
          <span
            className="hand"
            style={{
              position: 'absolute',
              left: '-8%',
              top: '-6%',
              fontSize: 20,
              color: 'var(--amber)',
              transform: 'rotate(-4deg)',
            }}
          >
            illustration — how a share lands
          </span>
          <div className="phone">
            <div className="phone-notch" aria-hidden />
            <div className="phone-head">
              <span className="wa-av serif">A</span>
              <div>
                <b style={{ fontSize: 13.5 }}>Ananya</b>
                <br />
                <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>online</span>
              </div>
            </div>
            <div className="phone-body">
              <div className="wab out">
                This week’s practice: 4-7-8 breathing, ten minutes before bed. Your full plan and
                progress report are here —<span className="wab-link">🔗 Your private portal</span>
                <i className="mono">6:12 PM ✓✓</i>
              </div>
              <div className="wab in">
                Did it before bed — slept till 6 for the first time this month 🙂
                <i className="mono">10:04 PM</i>
              </div>
              <div className="wab out">
                Lovely. Quick PHQ-9 check-in before Thursday? Two minutes, same link.
                <i className="mono">10:12 PM ✓✓</i>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   The room + pilot + FAQ + final CTA + footer
   ========================================================================== */

function TheRoom() {
  return (
    <section className="room-sect">
      <div className="wrap" style={{ textAlign: 'center' }}>
        <RoomArt />
        <h2
          className="serif rv"
          style={{
            ...d(100),
            fontSize: 'clamp(26px,3.4vw,40px)',
            lineHeight: 1.12,
            letterSpacing: '-.015em',
            fontWeight: 600,
            maxWidth: '24ch',
            margin: '26px auto 0',
          }}
        >
          Built for the room where therapy{' '}
          <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>actually happens.</em>
        </h2>
        <p
          className="rv"
          style={{
            ...d(180),
            fontSize: 15,
            lineHeight: 1.7,
            color: 'var(--ink2)',
            maxWidth: '52ch',
            margin: '14px auto 0',
          }}
        >
          Two chairs, one conversation, and a copilot that stays out of it — no screens between you,
          no bot on the call, nothing to operate mid-session.
        </p>
      </div>
    </section>
  );
}

function Pilot() {
  return (
    <section className="sect" id="pilot">
      <div className="wrap pilot-grid">
        <div className="pilot-note rv">
          <p className="hand" style={{ fontSize: 26, color: 'var(--brand-deep)', lineHeight: 1.3 }}>
            “We watched therapists spend their Sunday evenings on notes. So we built the copilot
            we’d want in the room — and we’re giving it to the first cohort free.”
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <span
              className="wa-av serif"
              style={{
                width: 42,
                height: 42,
                fontSize: 17,
                background: 'var(--grad)',
                color: '#fff',
              }}
            >
              C
            </span>
            <div>
              <b style={{ fontSize: 14 }}>The Cureocity team</b>
              <br />
              <span style={{ fontSize: 12, color: 'var(--ink3)' }}>
                Health-tech · Kozhikode, Kerala · est. 2022
              </span>
            </div>
          </div>
          <BreathSigArt />
        </div>
        <div>
          <span className="eyebrow rv">The honest part</span>
          <h2 className="big rv" style={d(80)}>
            No fake logos.
            <br />A real pilot,{' '}
            <em style={{ fontStyle: 'italic', color: 'var(--brand)' }}>open now.</em>
          </h2>
          <div className="pilot-perks rv" style={d(180)}>
            <div>
              <b>Free through the pilot</b>
              <p>
                Every feature, no card, no lock-in. Pricing lands only after the cohort says it
                earns its keep.
              </p>
            </div>
            <div>
              <b>A direct line to the builders</b>
              <p>WhatsApp the founding team — fixes land in days, not quarters.</p>
            </div>
            <div>
              <b>Shape the toolkit</b>
              <p>
                The therapy library, the templates, the languages. Pilot therapists decide what gets
                built next.
              </p>
            </div>
          </div>
          <Link
            href="/login"
            className="btn primary rv"
            style={{ ...d(260), marginTop: 28, textDecoration: 'none' }}
          >
            Join the pilot cohort →
          </Link>
        </div>
      </div>
    </section>
  );
}

const FAQS: [string, string][] = [
  [
    'What does it cost?',
    'Nothing during the pilot. After that: one simple monthly plan for solo practice, priced for Indian practice economics and announced to the cohort first. No per-session metering surprises.',
  ],
  [
    'What does the copilot actually do mid-session — will it interrupt?',
    'It listens, silently. Risk phrases surface in a side rail with the verbatim quote and severity. Questions you haven’t asked queue quietly and retire the moment you cover them. A pacing bar tracks the arc. It never speaks, never pops over your notes, and every suggestion waits for your tap — accepted or dismissed, the record shows it was your call.',
  ],
  [
    'Does it actually work in Manglish and Hinglish?',
    'Code-mix is the default, not a mode. Every transcript segment carries its own language tag — mid-sentence switches included — and the therapy script speaks the client’s language while your documents stay in yours.',
  ],
  [
    'Where does the audio go?',
    'Transcription runs in Mumbai (asia-south1). Audio is deleted on a 30-day schedule. The transcript is structured under your client’s recorded consent, and every document is envelope-encrypted per practice.',
  ],
  [
    'Do I need new hardware or an app install?',
    'No. The phone or laptop already in your room records the session in the browser. No bot joins calls, nothing to install, no setup call needed.',
  ],
  [
    'Is this a medical device? Does it diagnose?',
    'No. Mind drafts; you decide. Every diagnosis, plan, and script is a suggestion until you confirm it — and the record shows exactly what you accepted, edited, or rejected.',
  ],
];

function Faq() {
  return (
    <section
      className="sect"
      id="faq"
      style={{ background: 'var(--paper)', borderTop: '1px solid var(--line)' }}
    >
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div style={{ textAlign: 'center' }}>
          <span className="eyebrow rv" style={{ justifyContent: 'center' }}>
            Questions therapists ask us
          </span>
          <h2 className="big rv" style={d(80)}>
            Before you ask —
          </h2>
        </div>
        <div className="faq rv" style={d(160)}>
          {FAQS.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="final grain">
      <div className="final-wash" aria-hidden>
        <i />
        <i />
      </div>
      <div className="wrap" style={{ textAlign: 'center', position: 'relative' }}>
        <h2
          className="serif"
          style={{
            fontSize: 'clamp(38px,5.4vw,62px)',
            lineHeight: 1.04,
            color: '#fff',
            letterSpacing: '-.018em',
            fontWeight: 620,
          }}
        >
          Your next session
          <br />
          <em style={{ fontStyle: 'italic', color: '#7DD3FC' }}>writes itself.</em>
        </h2>
        <p
          style={{
            color: 'rgba(255,255,255,.78)',
            maxWidth: '46ch',
            margin: '20px auto 0',
            fontSize: 16.5,
            lineHeight: 1.7,
          }}
        >
          Sign in with Google, set up your practice in under a minute, and record your first session
          — a roleplay counts.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 14,
            justifyContent: 'center',
            marginTop: 34,
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/login"
            className="btn"
            style={{
              background: '#fff',
              color: 'var(--brand-deep)',
              padding: '15px 34px',
              fontSize: 16,
              textDecoration: 'none',
            }}
          >
            Start free — no card
          </Link>
          <a
            href="mailto:shamil@cureo.city?subject=Cureocity%20Mind%20pilot"
            className="btn"
            style={{
              border: '1.5px solid rgba(255,255,255,.4)',
              color: '#fff',
              padding: '15px 34px',
              fontSize: 16,
              textDecoration: 'none',
            }}
          >
            Talk to the team
          </a>
        </div>
        <p
          className="hand"
          style={{ color: '#7DD3FC', fontSize: 21, marginTop: 26, transform: 'rotate(-1.5deg)' }}
        >
          first note in ~10 minutes. really.
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <div>
          <span className="brand">
            <span className="brand-mark" style={{ width: 30, height: 30 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M3 12h3l2.5-6 3 12 3-9 2 3H21"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="serif" style={{ fontSize: 16, fontWeight: 640 }}>
              Cureocity Mind
            </span>
          </span>
          <p
            style={{
              fontSize: 13,
              color: 'var(--ink3)',
              maxWidth: '30ch',
              marginTop: 12,
              lineHeight: 1.6,
            }}
          >
            The clinical copilot for Indian psychotherapists — from first hello to discharge.
          </p>
          <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 14 }}>
            A <b style={{ color: 'var(--ink2)' }}>Cureocity</b> health-tech product · Kozhikode
          </p>
        </div>
        <div style={{ display: 'flex', gap: 64, flexWrap: 'wrap' }}>
          <div>
            <p className="fh">Product</p>
            <p className="fl">
              <a href="#how">How it works</a>
            </p>
            <p className="fl">
              <a href="#live">During the session</a>
            </p>
            <p className="fl">
              <a href="#docs">The documents</a>
            </p>
            <p className="fl">
              <a href="#outcomes">Outcomes</a>
            </p>
            <p className="fl">
              <a href="#privacy">Your data</a>
            </p>
            <p className="fl">
              <Link href="/app">Open the app</Link>
            </p>
          </div>
          <div>
            <p className="fh">Family</p>
            <p className="fl">
              <Link href="/for-doctors">Cureocity Scribe — for doctors</Link>
            </p>
            <p className="fl">
              <Link href="/care">Cureocity Care</Link>
            </p>
            <p className="fl">
              <a href="https://cureocity.in" rel="noreferrer">
                cureocity.in
              </a>
            </p>
          </div>
          <div>
            <p className="fh">Legal</p>
            <p className="fl">
              <Link href="/privacy">Privacy</Link>
            </p>
            <p className="fl">
              <Link href="/terms">Terms</Link>
            </p>
          </div>
        </div>
      </div>
      <div
        className="wrap"
        style={{
          borderTop: '1px solid var(--line)',
          marginTop: 36,
          paddingTop: 20,
          paddingBottom: 34,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
          © 2026 Cureocity · Made for Indian practice
        </p>
        <p style={{ fontSize: 12, color: 'var(--ink3)' }}>
          Not a medical device. Clinical decisions remain with the treating professional.
        </p>
      </div>
    </footer>
  );
}
