import Link from 'next/link';
import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { HeroDemo } from '@/components/landing/HeroDemo';
import { Reveal } from '@/components/landing/Reveal';

/**
 * Sprint 34 — the marketing landing page.
 *
 * Statically rendered (no auth resolution here — the nav's "Open the
 * app" link goes to /app, whose guards handle login/onboarding). The
 * previous behaviour at `/` was a bare redirect to /app; signed-in
 * therapists now land here once and click through.
 *
 * Animation architecture: globals.css `lp-*` layer + two client
 * islands (Reveal = IntersectionObserver, HeroDemo = phased loop).
 * Everything else is server-rendered markup whose animations cascade
 * off the nearest Reveal's `.lp-in`. All claims below are shipped
 * product facts — no invented stats, no testimonials.
 */

export const metadata: Metadata = {
  title: 'Cureocity Mind — the clinical co-pilot for Indian therapists',
  description:
    'Record the session. Cureocity Mind drafts the SOAP note, an ICD-11 clinical brief, a step-by-step therapy script, and your next pre-session brief — in English, हिन्दी, മലയാളം, or the code-mix your clients actually speak. You confirm every clinical call.',
};

export default function LandingPage() {
  return (
    <main className="overflow-x-clip">
      {/* Reveal fallback for no-JS visitors. */}
      <noscript>
        <style>{`[data-lp-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>

      <Nav />
      <Hero />
      <LanguageMarquee />
      <HowItWorks />
      <FivePasses />
      <Outcomes />
      <ShareSection />
      <Security />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ============================================================================
   Nav
   ========================================================================== */

function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent)]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 12h3l2.5-6 3 12 3-9 2 3H21"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="font-serif text-lg font-semibold tracking-tight">Cureocity Mind</span>
    </Link>
  );
}

function Nav() {
  const links = [
    { href: '#how', label: 'How it works' },
    { href: '#passes', label: 'After each session' },
    { href: '#outcomes', label: 'Outcomes' },
    { href: '#security', label: 'Security' },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-line-soft)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <Container as="nav" className="flex h-16 items-center justify-between">
        <Wordmark />
        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm text-[var(--color-ink-2)] transition-colors hover:text-[var(--color-ink)]"
            >
              {l.label}
            </a>
          ))}
          <Link
            href="/for-doctors"
            className="text-sm text-[var(--color-ink-2)] transition-colors hover:text-[var(--color-ink)]"
          >
            For doctors
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/app" size="sm">
            Open the app
          </ButtonLink>
        </div>
      </Container>
    </header>
  );
}

/* ============================================================================
   Hero
   ========================================================================== */

function FloatingChip({
  children,
  className = '',
  dur = '6s',
  delay = '0ms',
}: {
  children: ReactNode;
  className?: string;
  dur?: string;
  delay?: string;
}) {
  return (
    <span
      className={`lp-float absolute hidden items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-ink-2)] shadow-[0_12px_32px_-16px_rgba(15,27,42,0.25)] lg:inline-flex ${className}`}
      style={{ '--lp-float-dur': dur, '--lp-float-delay': delay } as CSSProperties}
      aria-hidden
    >
      {children}
    </span>
  );
}

function Hero() {
  return (
    <section className="relative">
      {/* Aurora */}
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="lp-blob lp-blob-a left-[-10%] top-[-18%] h-[480px] w-[480px] bg-[#cfe3d6] opacity-70" />
        <div className="lp-blob lp-blob-b right-[-12%] top-[-6%] h-[420px] w-[420px] bg-[#ead9bc] opacity-60" />
        <div className="lp-blob lp-blob-c left-[28%] top-[30%] h-[360px] w-[360px] bg-[#dce9e2] opacity-60" />
      </div>

      <Container className="grid items-center gap-14 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-24">
        <div>
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
              For Indian psychotherapists
            </p>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="mt-4 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.4rem]">
              Hold the session.
              <br />
              The paperwork{' '}
              <span className="relative inline-block italic text-[var(--color-accent)]">
                writes itself.
                <svg
                  className="lp-flourish absolute -bottom-2 left-0 w-full"
                  viewBox="0 0 300 14"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <path
                    d="M4 10C60 3 150 2 296 8"
                    stroke="var(--color-accent)"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    opacity="0.45"
                  />
                </svg>
              </span>
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-ink-2)]">
              Record the session — Cureocity Mind drafts the SOAP note, an ICD-11 clinical brief, a
              step-by-step therapy script, and your next pre-session brief. In English, हिन्दी,
              മലയാളം — or the code-mix your clients actually speak.
            </p>
          </Reveal>
          <Reveal delay={260}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/login" size="lg">
                Start free
              </ButtonLink>
              <ButtonLink href="#how" variant="secondary" size="lg">
                See how it works
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={340}>
            <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--color-ink-3)]">
              {[
                'DPDP-ready by design',
                'Encrypted per practice',
                'You confirm every clinical call',
              ].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span aria-hidden className="h-1 w-1 rounded-full bg-[var(--color-accent)]" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={200} className="relative">
          <HeroDemo />
          <FloatingChip className="-left-6 -top-5" dur="6.5s">
            <Dot /> ICD-11 brief
          </FloatingChip>
          <FloatingChip className="-right-5 top-16" dur="7.5s" delay="900ms">
            <Dot /> PHQ-9 ↓ reliable change
          </FloatingChip>
          <FloatingChip className="-bottom-5 left-10" dur="5.5s" delay="450ms">
            <Dot /> Shares to WhatsApp
          </FloatingChip>
        </Reveal>
      </Container>
    </section>
  );
}

function Dot() {
  return <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />;
}

/* ============================================================================
   Language marquee
   ========================================================================== */

const LANGS = [
  'English',
  'हिन्दी',
  'Hinglish',
  'മലയാളം',
  'Manglish',
  'தமிழ்',
  'తెలుగు',
  'ಕನ್ನಡ',
  'বাংলা',
  'मराठी',
  'ગુજરાતી',
  'ਪੰਜਾਬੀ',
];

function MarqueeRow({ ariaHidden = false }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center" aria-hidden={ariaHidden}>
      {LANGS.map((l) => (
        <span key={l} className="flex items-center">
          <span className="px-6 font-serif text-2xl text-[var(--color-ink-2)] sm:text-3xl">
            {l}
          </span>
          <span aria-hidden className="text-[var(--color-accent)]">
            ✦
          </span>
        </span>
      ))}
    </div>
  );
}

function LanguageMarquee() {
  return (
    <section className="border-y border-[var(--color-line-soft)] bg-white/60 py-8">
      <Reveal>
        <p className="mb-5 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-ink-3)]">
          The languages therapy actually happens in
        </p>
        <div className="lp-marquee overflow-hidden">
          <div className="lp-marquee-track">
            <MarqueeRow />
            <MarqueeRow ariaHidden />
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ============================================================================
   How it works
   ========================================================================== */

const STEPS = [
  {
    n: '01',
    title: 'Record',
    body: 'Tap record on the device already in the room. You get a diarized transcript, tagged speaker-by-speaker and language-by-language — mid-sentence switches included.',
  },
  {
    n: '02',
    title: 'Review',
    body: 'Drafts arrive while you stretch: the note, the ICD-11 brief, the plan. Accept, edit, or reject each suggestion — every edit is tracked field-by-field.',
  },
  {
    n: '03',
    title: 'Share',
    body: 'Sign with your fingerprint, then send homework, the plan, or a progress report over WhatsApp, email, or a private portal link.',
  },
];

function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: ReactNode;
  sub?: string;
}) {
  return (
    <Reveal className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
        {eyebrow}
      </p>
      <h2 className="mt-3 font-serif text-4xl leading-[1.08] tracking-tight sm:text-5xl">
        {title}
      </h2>
      {sub && <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-2)]">{sub}</p>}
    </Reveal>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 py-20 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              Three moves. <span className="italic text-[var(--color-accent)]">Zero typing.</span>
            </>
          }
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 120}>
              <div className="lp-lift h-full rounded-3xl border border-[var(--color-line)] bg-white p-7">
                <span className="font-serif text-5xl font-light text-[var(--color-accent)]/35">
                  {s.n}
                </span>
                <h3 className="mt-4 font-serif text-2xl">{s.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                  {s.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ============================================================================
   Five passes
   ========================================================================== */

const PASSES = [
  {
    tag: 'Transcript',
    title: 'Diarized, language-tagged transcript',
    body: 'Speaker-separated and code-mix native. Hinglish and Manglish aren’t edge cases here — they’re the default.',
  },
  {
    tag: 'Note',
    title: 'SOAP note — or a real intake note',
    body: 'Treatment sessions get SOAP. First sessions get a proper intake note with a mental status exam. The app knows the difference.',
  },
  {
    tag: 'Clinical brief',
    title: 'ICD-11 diagnosis candidates',
    body: 'Each with confidence, supporting quotes from the transcript, assessment gaps, and a draft formulation — yours to confirm or reject.',
  },
  {
    tag: 'Therapy script',
    title: 'A script for the exercise itself',
    body: 'Step-by-step, with the exact words to say aloud — in the language your client understands — and branches for how they respond.',
  },
  {
    tag: 'Pre-session brief',
    title: 'Tomorrow’s 30-second read',
    body: 'Last session’s recap, today’s focus, an opening line, watchpoints, homework status. Read it as they sit down.',
  },
];

function FivePasses() {
  return (
    <section
      id="passes"
      className="scroll-mt-24 border-y border-[var(--color-line-soft)] bg-white/60 py-20 lg:py-28"
    >
      <Container>
        <SectionHeading
          eyebrow="After each session"
          title="One recording. Five working documents."
          sub="Every artefact is a draft until you sign it. Confirmed diagnoses and plans accumulate on the client record, so the AI sees the full arc — not one session at a time."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PASSES.map((p, i) => (
            <Reveal key={p.tag} delay={(i % 3) * 110}>
              <div className="lp-lift h-full rounded-3xl border border-[var(--color-line)] bg-white p-7">
                <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
                  {p.tag}
                </span>
                <h3 className="mt-4 font-serif text-[22px] leading-snug">{p.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                  {p.body}
                </p>
              </div>
            </Reveal>
          ))}
          <Reveal delay={220}>
            <a
              href="#outcomes"
              className="lp-lift flex h-full flex-col justify-between rounded-3xl border border-[var(--color-accent)] bg-[var(--color-accent)] p-7 text-white"
            >
              <div>
                <span className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium">
                  And then
                </span>
                <h3 className="mt-4 font-serif text-[22px] leading-snug">
                  The arc across sessions
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-white/85">
                  Journeys, reliable-change verdicts, and a progress report your client can actually
                  read.
                </p>
              </div>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium">
                See outcomes
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12h14m-6-6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </a>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

/* ============================================================================
   Outcomes — sparkline + journey rail
   ========================================================================== */

const SPARK_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  // [x, y, score] — PHQ-9 across eight sessions, 18 → 4 (remission ≤ 4).
  [10, 28, 18],
  [53, 38, 16],
  [96, 43, 15],
  [139, 58, 12],
  [182, 73, 9],
  [225, 83, 7],
  [268, 93, 5],
  [310, 98, 4],
];

const STAGES = ['Intake', 'Assessment', 'Active treatment', 'Review', 'Discharge'];

function OutcomeChart() {
  const path = SPARK_POINTS.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  return (
    <div className="relative rounded-3xl border border-[var(--color-line)] bg-white p-6 shadow-[0_32px_80px_-36px_rgba(15,27,42,0.25)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">PHQ-9 across treatment</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">Eight sessions, one client</p>
        </div>
        <span className="lp-spark-verdict inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M20 6L9 17l-5-5"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Reliable improvement · remission
        </span>
      </div>

      <svg
        viewBox="0 0 320 130"
        className="mt-5 w-full"
        role="img"
        aria-label="PHQ-9 score falling from 18 to 4 over eight sessions, crossing the remission threshold"
      >
        <line
          x1="10"
          y1="98"
          x2="310"
          y2="98"
          stroke="var(--color-line)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <text x="310" y="112" textAnchor="end" fontSize="9" fill="var(--color-ink-3)">
          remission ≤ 4
        </text>
        <polygon
          points={`${SPARK_POINTS.map(([x, y]) => `${x},${y}`).join(' ')} 310,126 10,126`}
          fill="var(--color-accent)"
          opacity="0.06"
        />
        <path
          d={path}
          className="lp-spark-path"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {SPARK_POINTS.map(([x, y], i) => (
          <circle
            key={x}
            cx={x}
            cy={y}
            r="3.5"
            fill="white"
            stroke="var(--color-accent)"
            strokeWidth="2"
            className="lp-spark-dot"
            style={{ '--lp-dot-i': i } as CSSProperties}
          />
        ))}
        <text x="10" y="18" fontSize="10" fontWeight="600" fill="var(--color-ink-2)">
          18
        </text>
        <text x="298" y="92" fontSize="10" fontWeight="600" fill="var(--color-accent)">
          4
        </text>
      </svg>

      <div className="mt-5 grid grid-cols-5 gap-1.5">
        {STAGES.map((s, i) => (
          <div key={s} className="lp-stage" style={{ '--lp-stage-i': i } as CSSProperties}>
            <div className="lp-stage-bar h-1 rounded-full bg-[var(--color-accent)]" />
            <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-3)]">
              {s}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Outcomes() {
  return (
    <section id="outcomes" className="scroll-mt-24 py-20 lg:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="Measurement-based care"
            title={
              <>
                Therapy you can <span className="italic text-[var(--color-accent)]">see</span>{' '}
                working.
              </>
            }
            sub="PHQ-9 and GAD-7 live in the flow of the session, and the verdict is deterministic — reliable-change thresholds straight from the validation literature, never a model's opinion."
          />
          <Reveal delay={150}>
            <ul className="mt-8 space-y-4">
              {[
                [
                  'A journey, not a pile of notes',
                  'Each client gets an arc — intake to discharge — with a next-best-action so nothing drifts.',
                ],
                [
                  'Honest verdicts',
                  'Improvement only counts when it clears reliable-change thresholds. Plateaus and deteriorations are flagged just as plainly.',
                ],
                [
                  'A report your client can read',
                  'One tap turns the arc into a plain-language progress report — shareable on WhatsApp.',
                ],
              ].map(([t, b]) => (
                <li key={t} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                  </span>
                  <p className="text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                    <span className="font-semibold text-[var(--color-ink)]">{t}.</span> {b}
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal delay={120}>
          <OutcomeChart />
        </Reveal>
      </Container>
    </section>
  );
}

/* ============================================================================
   Share
   ========================================================================== */

function ShareSection() {
  return (
    <section className="border-y border-[var(--color-line-soft)] bg-white/60 py-20 lg:py-28">
      <Container className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal delay={120} className="order-last lg:order-first">
          <div className="mx-auto max-w-sm rounded-3xl border border-[var(--color-line)] bg-white p-5 shadow-[0_32px_80px_-36px_rgba(15,27,42,0.25)]">
            <div className="flex items-center gap-3 border-b border-[var(--color-line-soft)] pb-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-soft)] font-serif text-sm font-semibold text-[var(--color-accent)]">
                A
              </span>
              <div>
                <p className="text-sm font-semibold leading-tight">Ananya</p>
                <p className="text-[11px] text-[var(--color-ink-3)]">WhatsApp · after session 4</p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <div
                className="lp-bubble ml-8 rounded-2xl rounded-tr-sm border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3.5"
                style={{ '--lp-bubble-i': 0 } as CSSProperties}
              >
                <p className="text-[13px] leading-relaxed text-[var(--color-ink)]">
                  This week&rsquo;s practice: 4-7-8 breathing, ten minutes before bed. Your full
                  plan and progress report are here —
                </p>
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-accent)]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M10 14a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 1 0-7.07-7.07L11 5.93M14 10a5 5 0 0 0-7.07 0L4.8 12.12a5 5 0 1 0 7.07 7.07L13 19.07"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                  Your private portal link
                </span>
              </div>
              <div
                className="lp-bubble mr-8 rounded-2xl rounded-tl-sm bg-[var(--color-accent-soft)] p-3.5"
                style={{ '--lp-bubble-i': 1 } as CSSProperties}
              >
                <p className="text-[13px] leading-relaxed text-[var(--color-ink)]">
                  Did it before bed — slept till 6 for the first time this month 🙂
                </p>
              </div>
              <div
                className="lp-bubble ml-8 rounded-2xl rounded-tr-sm border border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] p-3.5"
                style={{ '--lp-bubble-i': 2 } as CSSProperties}
              >
                <p className="text-[13px] leading-relaxed text-[var(--color-ink)]">
                  Lovely. Quick PHQ-9 check-in before Thursday? Two minutes, same link.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
        <div>
          <SectionHeading
            eyebrow="Between sessions"
            title={
              <>
                Therapy doesn&rsquo;t end{' '}
                <span className="italic text-[var(--color-accent)]">at the door.</span>
              </>
            }
            sub="Homework, plans, reflection prompts, and progress reports go out over WhatsApp, email, or a private portal link — consent-gated, in your client's preferred language, with every share audited."
          />
          <Reveal delay={150}>
            <p className="mt-6 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
              The portal is a clean page, not an app your client has to install. They open the link,
              read the plan, fill the check-in. You see it before the next session.
            </p>
          </Reveal>
        </div>
      </Container>
    </section>
  );
}

/* ============================================================================
   Security
   ========================================================================== */

const SECURITY_CELLS: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: 'Encrypted per practice',
    body: 'Client PII is envelope-encrypted with a key unique to your practice — AES-256-GCM, never shared across tenants.',
    icon: (
      <path
        d="M7 11V8a5 5 0 0 1 10 0v3m-12 0h14v9H5v-9Zm7 3v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Biometric sign-off',
    body: 'Notes are signed with your fingerprint or face. The signature is cryptographically verified against your registered device — not just recorded.',
    icon: (
      <path
        d="M12 11a3 3 0 0 1 3 3c0 2.5-1 4.5-2 6m-4-2.5c.7-1.2 1-2.3 1-3.5a3 3 0 0 1 .5-1.7M6.8 8.5A7 7 0 0 1 19 14c0 1.2-.1 2.4-.4 3.5M4.6 12A7 7 0 0 1 5 9.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Everything audited',
    body: 'Every read and write lands in an append-only audit log — built for the data-subject requests the DPDP Act gives your clients.',
    icon: (
      <path
        d="M5 4h14v16H5V4Zm4 5h6M9 12h6M9 15h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'AI runs in-region',
    body: 'Session audio is transcribed on Vertex AI in asia-south1 (Mumbai) — residency by architecture, not by promise.',
    icon: (
      <path
        d="M12 21s-7-5.3-7-11a7 7 0 0 1 14 0c0 5.7-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'You stay in charge',
    body: 'Every diagnosis, plan, and script is a suggestion until you confirm it. Nothing reaches the record — or your client — without your sign-off.',
    icon: (
      <path
        d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Zm-3 9 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: 'Crisis-aware',
    body: 'Risk flags surface with severity and indicators the moment a draft lands — with Indian crisis hotlines built into the pathway.',
    icon: (
      <path
        d="M4 16.5c2-1.2 3-3.5 3-6a5 5 0 0 1 10 0c0 2.5 1 4.8 3 6M9 20h6m-9.5-3.5h13"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

function Security() {
  return (
    <section id="security" className="scroll-mt-24 py-20 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Security & DPDP"
          title={
            <>
              Built like it&rsquo;s health data.{' '}
              <span className="italic text-[var(--color-accent)]">Because it is.</span>
            </>
          }
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY_CELLS.map((c, i) => (
            <Reveal key={c.title} delay={(i % 3) * 110}>
              <div className="lp-lift h-full rounded-3xl border border-[var(--color-line)] bg-white p-7">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                    {c.icon}
                  </svg>
                </span>
                <h3 className="mt-4 text-base font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ============================================================================
   Final CTA + footer
   ========================================================================== */

function FinalCta() {
  return (
    <section className="pb-24 pt-4 lg:pb-32">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2.5rem] bg-[var(--color-accent)] px-8 py-16 text-center text-white sm:px-16 lg:py-20">
            <div className="absolute inset-0 overflow-hidden" aria-hidden>
              <div className="lp-blob lp-blob-a left-[-8%] top-[-40%] h-[380px] w-[380px] bg-white opacity-10" />
              <div className="lp-blob lp-blob-b bottom-[-50%] right-[-10%] h-[420px] w-[420px] bg-[#9ec5b2] opacity-20" />
            </div>
            <div className="relative">
              <h2 className="mx-auto max-w-2xl font-serif text-4xl leading-[1.08] tracking-tight sm:text-5xl">
                Your next session <span className="italic">writes itself.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/80">
                Sign in with your phone number, set up your practice in under a minute, and record
                your first session — a roleplay counts.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <ButtonLink
                  href="/login"
                  size="lg"
                  className="!bg-white !text-[var(--color-accent)] hover:!bg-[var(--color-surface-soft)]"
                >
                  Start free
                </ButtonLink>
                <ButtonLink
                  href="/app"
                  size="lg"
                  variant="secondary"
                  className="!border-white/30 !bg-transparent !text-white hover:!border-white"
                >
                  Open the app
                </ButtonLink>
              </div>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-line-soft)] bg-white/60 py-12">
      <Container>
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-3)]">
              The clinical co-pilot for Indian psychotherapists — from first hello to discharge.
            </p>
          </div>
          <div className="flex gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Product
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-ink-2)]">
                {[
                  ['#how', 'How it works'],
                  ['#passes', 'After each session'],
                  ['#outcomes', 'Outcomes'],
                  ['#security', 'Security'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <a href={href} className="transition-colors hover:text-[var(--color-ink)]">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Account
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-ink-2)]">
                <li>
                  <Link href="/login" className="transition-colors hover:text-[var(--color-ink)]">
                    Sign in
                  </Link>
                </li>
                <li>
                  <Link href="/app" className="transition-colors hover:text-[var(--color-ink)]">
                    Open the app
                  </Link>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-[var(--color-line-soft)] pt-6 text-xs text-[var(--color-ink-3)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            © 2026 Cureocity · Made for Indian practice ·{' '}
            <Link href="/privacy" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
              Privacy
            </Link>{' '}
            ·{' '}
            <Link href="/terms" className="underline underline-offset-2 hover:text-[var(--color-ink)]">
              Terms
            </Link>
          </p>
          <p>Not a medical device. Clinical decisions remain with the treating professional.</p>
        </div>
      </Container>
    </footer>
  );
}
