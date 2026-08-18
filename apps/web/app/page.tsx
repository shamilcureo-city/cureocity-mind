import Link from 'next/link';
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import './landing.css';
import { DocsTabs } from '@/components/landing/DocsTabs';
import { Counter, LandingFx, LangWord } from '@/components/landing/LandingFx';
import { LandingNav } from '@/components/landing/LandingNav';
import { LiveRailDemo } from '@/components/landing/LiveRailDemo';
import { WatchItWork } from '@/components/landing/WatchItWork';

/**
 * The marketing landing page — v10 "glass aurora" redesign.
 *
 * One continuous aurora canvas (periwinkle → peach washes), frosted-glass
 * cards, bevelled 3D icon tiles, black-led controls. Built from the approved
 * screenshot-driven mock; all styling lives in ./landing.css, scoped under
 * `.lnd` so the shared lp-* layer (still used by /for-doctors) and the app
 * tokens are untouched. Client interactivity is confined to islands in
 * components/landing/: the nav burger, the live-rail loop, the documents
 * tabs, the counters, the reveal observer, and the "Watch it work" player.
 *
 * The honesty policy holds: every claim below is a shipped product fact —
 * no invented stats, no testimonials; the WhatsApp vignette is labelled an
 * illustration and the pilot section says plainly that the product is new.
 */

export const metadata: Metadata = {
  title: 'Cureocity Mind — the clinical copilot for Indian therapists',
  description:
    'You listen. Mind writes. A clinical copilot flags risk as it’s spoken, queues the questions you haven’t asked, and turns the session into a SOAP note, ICD-11 clinical brief, therapy script, and next-session prep. In English, हिन्दी, മലയാളം, or the code-mix your clients actually speak.',
};

const d = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M5 13l4 4 10-11" />
    </svg>
  );
}

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
      <Stage />
      <Stats />
      <HowItWorks />
      <LiveSection />
      <Documents />
      <CodeMix />
      <Growth />
      <Outcomes />
      <Privacy />
      <BetweenSessions />
      <Pilot />
      <Faq />
      <FinalCta />
      <Footer />
      <LandingFx />
    </main>
  );
}

/* ============================================================================
   Hero — the hook + the product's core gesture
   ========================================================================== */

function Hero() {
  return (
    <header className="hero wrap">
      <span className="hero-badge rv in">
        <span className="dot" /> The clinical copilot for Indian therapists
      </span>
      <h1 className="h1 serif rv in">
        You listen.
        <br />
        <em>Mind writes.</em>
      </h1>
      <p className="hero-sub rv in" style={d(120)}>
        Give the whole hour to the person in front of you. A copilot flags risk as it’s spoken,
        queues what you haven’t asked, and turns every session into five signed-off documents — in
        English, हिन्दी, മലയാളം, or the code-mix your clients actually speak.
      </p>
      <div className="hero-ctas rv in" style={d(220)}>
        <Link href="/login" className="btn primary" style={{ textDecoration: 'none' }}>
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
    </header>
  );
}

function Stage() {
  return (
    <div className="stage">
      <div className="session-card rv in">
        <div className="sc-select">
          <span className="av">A</span>
          <span>
            <b>Ananya R</b> &nbsp;·&nbsp; 4:30 PM · Treatment
          </span>
          <span className="chev">▾</span>
        </div>
        <div className="sc-chips">
          <span className="sc-chip">
            Note language · <b>English</b>
          </span>
          <span className="sc-chip">
            Style · <b>CBT</b>
          </span>
          <span className="sc-chip">
            <b>In-person</b>
          </span>
        </div>
        <div className="mic-zone">
          <div className="mic">
            <span className="mic-in">
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3zM6 12a6 6 0 0 0 12 0M12 18v3" />
              </svg>
            </span>
          </div>
          <p className="mic-cap">Start listening</p>
          <p className="mic-sub">Recording begins the moment you tap · consent confirmed</p>
        </div>
      </div>

      <div className="sat s1 rv in" style={d(150)}>
        <h6>
          <span className="reddot" /> Live transcript · diarized
        </h6>
        <div className="wave" aria-hidden>
          {[40, 75, 55, 90, 48, 80, 60, 38, 70, 52].map((h, i) => (
            <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
        <p>
          <span className="lt">ml-en</span>“Sleep okay aanu, pakshe office il chennaal chest il oru
          tightness…”
        </p>
      </div>

      <div className="sat s2 rv in" style={d(220)}>
        <h6>Risk watch · you decide</h6>
        <p>“Sometimes I feel everyone would be better off without me.”</p>
        <div className="acts">
          <span className="a1">Assessed ✓</span>
          <span className="a2">Not relevant</span>
        </div>
      </div>

      <div className="sat s3 rv in" style={d(290)}>
        <h6>PHQ-9 · reliable change</h6>
        <div className="vd">
          <b>18 → 7</b>
          <span>−61% · improving</span>
        </div>
        <svg width="205" height="34" viewBox="0 0 205 34" fill="none" aria-hidden>
          <path
            d="M2 6 C30 8 44 14 70 16 S130 24 200 29"
            stroke="#5c6bd6"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <circle cx="200" cy="29" r="3.4" fill="#5c6bd6" />
        </svg>
      </div>

      <div className="sat s4 rv in" style={d(360)}>
        <h6>Shared to WhatsApp · consented</h6>
        <div className="bub">
          This week’s practice: 4-7-8 breathing before bed. Full plan here —
          <span className="link">🔗 private portal</span>
        </div>
      </div>
    </div>
  );
}

function Stats() {
  return (
    <div className="stats">
      <div className="stat rv">
        <b>
          <Counter to={5} />
        </b>
        <span className="cap">working documents from one recording</span>
      </div>
      <div className="stat rv" style={d(90)}>
        <b>
          <Counter to={12} />+
        </b>
        <span className="cap">languages &amp; code-mixes — Manglish included</span>
      </div>
      <div className="stat rv" style={d(180)}>
        <b>
          <Counter to={30} />
          -day
        </b>
        <span className="cap">audio auto-delete, transcribed in Mumbai</span>
      </div>
      <div className="stat rv" style={d(270)}>
        <b>1 tap</b>
        <span className="cap">to share homework on WhatsApp</span>
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
      <div className="wrap center">
        <span className="eyebrow rv">How it works</span>
        <h2 className="big rv serif" style={d(80)}>
          Three taps. <em>That’s the whole workflow.</em>
        </h2>
      </div>
      <div className="wrap how-grid">
        <div className="how-card rv">
          <span className="how-step mono">STEP 01</span>
          <span className="tile t-peri">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <rect x="9" y="3.5" width="6" height="11" rx="3" />
              <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
            </svg>
          </span>
          <h3 className="serif">Record</h3>
          <p>
            Tap record — in the room or online. You get a diarized transcript, tagged
            speaker-by-speaker and language-by-language, mid-sentence switches included.
          </p>
        </div>
        <div className="how-card rv" style={d(140)}>
          <span className="how-step mono">STEP 02</span>
          <span className="tile t-peach">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 3.5h9l4 4v13H6zM14.5 3.5v4.5h4.5M9.5 13h6M9.5 16.5h4" />
            </svg>
          </span>
          <h3 className="serif">Review</h3>
          <p>
            The note, the ICD-11 brief, the plan — each one a draft with its evidence attached.
            Accept, edit, or reject every suggestion; each call is tracked.
          </p>
        </div>
        <div className="how-card rv" style={d(280)}>
          <span className="how-step mono">STEP 03</span>
          <span className="tile t-mint">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M21 3.5 3.5 10.5l6.5 3 3 6.5zM21 3.5 10 13.5" />
            </svg>
          </span>
          <h3 className="serif">Sign &amp; share</h3>
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
   During the session — the dark glass slab
   ========================================================================== */

function LiveSection() {
  return (
    <section className="slab" id="live">
      <div className="wrap night-grid">
        <div>
          <span className="eyebrow">During the session</span>
          <h2 className="big serif">
            A copilot in the room, <em>silent by design.</em>
          </h2>
          <p className="sub">
            Go live and it listens alongside you. Risk phrases surface the moment they’re spoken.
            Unexplored threads queue quietly. The note assembles itself in the margin — while your
            eyes stay on the person in front of you.
          </p>
          <div className="nf">
            <div>
              <span className="tile t-peach">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
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
              <span className="tile t-peri">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
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
              <span className="tile t-lav">
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
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
        <LiveRailDemo />
      </div>
    </section>
  );
}

/* ============================================================================
   Five documents
   ========================================================================== */

function Documents() {
  return (
    <section className="sect" id="docs">
      <div className="wrap center">
        <span className="eyebrow rv">After each session</span>
        <h2 className="big rv serif" style={d(80)}>
          One hour of therapy. <em>Five finished documents.</em>
        </h2>
        <p className="sub rv" style={d(160)}>
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
   Code-mix
   ========================================================================== */

function CodeMix() {
  return (
    <section className="sect" id="lang">
      <div className="wrap center">
        <span className="eyebrow rv">Code-mix first</span>
        <h2 className="big rv serif" style={d(80)}>
          Therapy here happens in <LangWord />
        </h2>
        <p className="sub rv" style={d(160)}>
          Not “English with errors” — a language of its own. Every segment is tagged, mid-sentence
          switches included; your documents come out in your language, the client’s homework in
          theirs.
        </p>
        <div className="lang-demo rv" style={d(240)}>
          <div className="lang-chip">
            <span className="lt">hi-en</span>“Raat ko neend nahi aati,{' '}
            <mark>presentation se pehle</mark> heartbeat badh jaata hai”
          </div>
          <span className="lang-arrow" aria-hidden>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 12h15M13 6l6 6-6 6" />
            </svg>
          </span>
          <div className="lang-chip">
            <b>S —</b> Sleep-onset difficulty; anticipatory palpitations before presentations.
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Practice growth — public page + booking + in-app video (Marketing V1 + MK9)
   ========================================================================== */

function Growth() {
  return (
    <section className="sect" id="grow">
      <div className="wrap center">
        <span className="eyebrow rv">Beyond the session</span>
        <h2 className="big rv serif" style={d(80)}>
          Your name, <em>bookable.</em>
        </h2>
        <p className="sub rv" style={d(160)}>
          Mind isn’t only the hour of therapy — it runs the practice around it. A public page that
          fills your calendar, and video sessions that happen inside the product.
        </p>
      </div>
      <div className="wrap grow-grid">
        <div className="grow-card rv">
          <span className="tile t-sky">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="12" cy="8.5" r="3.5" />
              <path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" />
            </svg>
          </span>
          <h3 className="serif">Your public page</h3>
          <p>
            A profile clients actually find — your story, specialties, FAQs, and posts at{' '}
            <b>mind.cureocity.in/therapists/you</b>. AI drafts the copy from your real practice.
          </p>
          <div className="mini">
            <div className="row">
              <span className="av">P</span>
              <div>
                <p className="nm">Dr. Priya Menon</p>
                <p className="cp">Anxiety &amp; trauma · Kochi · ₹1,800</p>
              </div>
            </div>
          </div>
        </div>
        <div className="grow-card rv" style={d(140)}>
          <span className="tile t-peri">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <rect x="4" y="5.5" width="16" height="15" rx="3" />
              <path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4" />
            </svg>
          </span>
          <h3 className="serif">Real slot booking</h3>
          <p>
            Your weekly hours become live slots. A request holds the time; you confirm with one tap
            — the client file and intake session are created for you.
          </p>
          <div className="mini">
            <p className="cp mono" style={{ fontWeight: 700, letterSpacing: '.06em' }}>
              THU 31 JUL
            </p>
            <div className="slot-row">
              <span className="slot">10:00</span>
              <span className="slot on">11:00</span>
              <span className="slot">4:30</span>
              <span className="slot">6:00</span>
            </div>
          </div>
        </div>
        <div className="grow-card rv" style={d(280)}>
          <span className="tile t-lav">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <rect x="3" y="6" width="13" height="12" rx="3" />
              <path d="M16 10.5 21 8v8l-5-2.5" />
            </svg>
          </span>
          <h3 className="serif">Video, built in</h3>
          <p>
            Online clients join from the confirmation itself — no Meet links, no “can you see me?”.
            One private room per appointment, open 30 minutes before.
          </p>
          <div className="vroom" aria-hidden>
            <span className="who">Ananya · connected</span>
            <span className="me" />
            <span className="ctrls">
              <i>🎙</i>
              <i className="end">✕</i>
              <i>📷</i>
            </span>
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
    <section className="sect" id="outcomes">
      <div className="wrap out-grid">
        <div>
          <span className="eyebrow rv">Measurement-based care</span>
          <h2 className="big rv serif" style={d(80)}>
            Progress you can <em>prove.</em>
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
        <div className="out-card rv" style={d(150)}>
          <div className="out-head">
            <div>
              <b>PHQ-9 across treatment</b>
              <span className="cap">Eight sessions · one client</span>
            </div>
            <span className="verdict">✓ Reliable improvement · remission</span>
          </div>
          <svg
            width="100%"
            height="150"
            viewBox="0 0 460 150"
            fill="none"
            style={{ marginTop: 16 }}
            aria-hidden
          >
            <path d="M0 118 H460 M0 78 H460 M0 38 H460" stroke="rgba(11,12,16,.05)" />
            <path
              d="M20 24 C80 30 120 44 170 58 S300 96 440 122"
              stroke="#5c6bd6"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path
              d="M20 24 C80 30 120 44 170 58 S300 96 440 122 L440 150 L20 150 Z"
              fill="url(#lndg1)"
            />
            <defs>
              <linearGradient id="lndg1" x1="0" y1="0" x2="0" y2="1">
                <stop stopColor="rgba(92,107,214,.2)" />
                <stop offset="1" stopColor="rgba(92,107,214,0)" />
              </linearGradient>
            </defs>
            <circle cx="20" cy="24" r="4" fill="#5c6bd6" />
            <circle cx="170" cy="58" r="4" fill="#5c6bd6" />
            <circle cx="440" cy="122" r="5" fill="#5c6bd6" />
          </svg>
          <div className="stages">
            <span className="done">Intake</span>
            <span className="done">Assessment</span>
            <span className="done">Treatment</span>
            <span className="on">Review</span>
            <span>Discharge</span>
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
        <div className="india-card rv">
          <div className="pin3d">
            <svg
              width="34"
              height="34"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 21s-6.5-5.2-6.5-10a6.5 6.5 0 0 1 13 0c0 4.8-6.5 10-6.5 10z" />
              <circle cx="12" cy="10.6" r="2.4" />
            </svg>
          </div>
          <span className="mh">AUDIO RESIDENCY</span>
          <p>
            Session audio is transcribed on Vertex AI in <b>Mumbai</b> and never stored beyond 30
            days. Structuring runs on the transcript under your client’s recorded consent.
          </p>
        </div>
        <div>
          <span className="eyebrow rv">Your data · DPDP</span>
          <h2 className="big rv serif" style={d(80)}>
            Health-data serious, <em>in writing.</em>
          </h2>
          <p className="sub rv" style={d(140)}>
            Built like it’s health data — because it is. No fine print contradicts any of this:
          </p>
          <div className="priv-list rv" style={d(220)}>
            <div>
              <span className="tile t-peri">01</span>
              <div>
                <b>Audio is deleted on schedule.</b>
                <p>
                  Transcription happens in real time; a 30-day purge is enforced by a cron, not a
                  policy PDF.
                </p>
              </div>
            </div>
            <div>
              <span className="tile t-peach">02</span>
              <div>
                <b>Encrypted per practice.</b>
                <p>
                  Client PII is envelope-encrypted with a key unique to your practice — AES-256-GCM,
                  never shared across tenants.
                </p>
              </div>
            </div>
            <div>
              <span className="tile t-mint">03</span>
              <div>
                <b>Never used for training.</b>
                <p>
                  Your sessions produce your documents. They don’t train our models or anyone
                  else’s.
                </p>
              </div>
            </div>
            <div>
              <span className="tile t-lav">04</span>
              <div>
                <b>Audited; you sign everything.</b>
                <p>
                  Append-only audit log built for DPDP data-subject requests; notes sign with your
                  fingerprint, cryptographically verified.
                </p>
              </div>
            </div>
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
    <section className="sect" id="between">
      <div className="wrap wa-grid">
        <div>
          <span className="eyebrow rv">Between sessions</span>
          <h2 className="big rv serif" style={d(80)}>
            Therapy doesn’t end <em>at the door.</em>
          </h2>
          <p className="sub rv" style={d(160)}>
            Homework, plans, and progress reports go out over WhatsApp, email, or a private portal
            link — consent-gated, in your client’s preferred language, every share audited.
          </p>
          <p className="sub rv" style={{ ...d(220), fontSize: 15 }}>
            The portal is a clean page, not an app to install. Your client opens the link, reads the
            plan, fills the two-minute check-in. You see it before the next session.
          </p>
        </div>
        <div className="rv" style={d(140)}>
          <div className="phone">
            <div className="phone-head">
              <span className="av">A</span>
              <div>
                <b style={{ fontSize: 13.5 }}>Ananya</b>
                <br />
                <span style={{ fontSize: 10.5, color: 'var(--ink3)' }}>online</span>
              </div>
            </div>
            <div className="phone-body">
              <div className="wab out">
                This week’s practice: 4-7-8 breathing, ten minutes before bed. Your full plan and
                progress report are here —<span className="link">🔗 Your private portal</span>
                <i>6:12 PM ✓✓</i>
              </div>
              <div className="wab in">
                Did it before bed — slept till 6 for the first time this month 🙂<i>10:04 PM</i>
              </div>
              <div className="wab out">
                Lovely. Quick PHQ-9 check-in before Thursday? Two minutes, same link.
                <i>10:12 PM ✓✓</i>
              </div>
            </div>
          </div>
          <p className="illus">illustration — how a share lands</p>
        </div>
      </div>
    </section>
  );
}

/* ============================================================================
   Pilot + FAQ + final CTA + footer
   ========================================================================== */

function Pilot() {
  return (
    <section className="sect" id="pilot">
      <div className="wrap pilot-grid">
        <div className="pilot-note rv">
          <p className="q">
            “We watched therapists spend their Sunday evenings on notes. So we built the copilot
            we’d want in the room — and we’re giving it to the first cohort free.”
          </p>
          <div className="pilot-team">
            <span
              className="av"
              style={{
                width: 44,
                height: 44,
                fontSize: 17,
                background: 'linear-gradient(150deg,#3d404c,#0b0c10)',
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
        </div>
        <div>
          <span className="eyebrow rv">The honest part</span>
          <h2 className="big rv serif" style={d(80)}>
            No fake logos. A real pilot, <em>open now.</em>
          </h2>
          <div className="perks rv" style={d(180)}>
            <div>
              <span className="tile t-mint">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M5 13l4 4 10-11" />
                </svg>
              </span>
              <div>
                <b>Free through the pilot</b>
                <p>
                  Every feature, no card, no lock-in. Pricing lands only after the cohort says it
                  earns its keep.
                </p>
              </div>
            </div>
            <div>
              <span className="tile t-peri">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M12 4a8 8 0 0 1 8 8c0 1.8-.6 3.4-1.6 4.8L20 21l-4.4-1.4A8 8 0 1 1 12 4z" />
                </svg>
              </span>
              <div>
                <b>A direct line to the builders</b>
                <p>WhatsApp the founding team — fixes land in days, not quarters.</p>
              </div>
            </div>
            <div>
              <span className="tile t-peach">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M12 3v18M3 12h18" />
                </svg>
              </span>
              <div>
                <b>Shape the toolkit</b>
                <p>
                  The therapy library, the templates, the languages. Pilot therapists decide what
                  gets built next.
                </p>
              </div>
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
    'No. The phone or laptop already in your room records the session in the browser. No bot joins calls, nothing to install, no setup call needed. Online sessions get an in-app video room — clients join from a link in their confirmation.',
  ],
  [
    'Is this a medical device? Does it diagnose?',
    'No. Mind drafts; you decide. Every diagnosis, plan, and script is a suggestion until you confirm it — and the record shows exactly what you accepted, edited, or rejected.',
  ],
];

function Faq() {
  return (
    <section className="sect" id="faq">
      <div className="wrap center">
        <span className="eyebrow rv">Questions therapists ask us</span>
        <h2 className="big rv serif" style={d(80)}>
          Before you ask —
        </h2>
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
    <section className="final">
      <h2 className="h1 serif" style={{ margin: '0 auto' }}>
        Your next session <em>writes itself.</em>
      </h2>
      <p className="sub2">
        Sign in with Google, set up your practice in under a minute, and record your first session —
        a roleplay counts.
      </p>
      <div className="hero-ctas" style={{ marginTop: 36 }}>
        <Link
          href="/login"
          className="btn inv"
          style={{ padding: '16px 36px', fontSize: 16, textDecoration: 'none' }}
        >
          Start free — no card
        </Link>
        <a
          href="mailto:shamil@cureo.city?subject=Cureocity%20Mind%20pilot"
          className="btn line"
          style={{ padding: '16px 36px', fontSize: 16, textDecoration: 'none' }}
        >
          Talk to the team
        </a>
      </div>
      <p className="tail">first note in ~10 minutes. really.</p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <div>
          <span className="brand">
            <span className="brand-mark">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M3 12h3l2.5-6 3 12 3-9 2 3H21"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="serif" style={{ fontSize: 16, fontWeight: 650 }}>
              Cureocity Mind
            </span>
          </span>
          <p className="desc">
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
              <a href="#grow">Your page</a>
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
      <div className="wrap foot-base">
        <p>© 2026 Cureocity · Made for Indian practice</p>
        <p>Not a medical device. Clinical decisions remain with the treating professional.</p>
      </div>
    </footer>
  );
}
