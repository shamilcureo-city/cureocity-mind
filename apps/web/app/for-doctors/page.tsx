import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';
import { Reveal } from '@/components/landing/Reveal';

/**
 * Sprint DV2 — the doctor-vertical marketing landing (`/for-doctors`).
 *
 * One system, two faces (see docs/DOCTOR_VERTICAL.md): this reuses the
 * therapist landing's animation layer (`lp-*` in globals.css) +
 * Container/ButtonLink/Reveal primitives, with doctor-specific copy. The
 * hero story is the LIVE copilot (3 rails) — the differentiator for the
 * high-volume super-specialty OPD. Honest copy only: no invented stats,
 * no testimonials; the product is in active development.
 */
export const metadata: Metadata = {
  title: 'Cureocity Scribe — the live AI copilot for Indian doctors',
  description:
    'A live ambient scribe for the OPD: the note builds as you speak, missing questions and red flags surface in the room, and the prescription drafts itself — in the code-mix your patients actually speak. You confirm every clinical call.',
};

export default function ForDoctorsLanding() {
  return (
    // Three-products split — Scribe wears its own identity: the page-scoped
    // token override recolors every accent use (buttons, chips, flourishes)
    // to clinical indigo without touching the shared design system.
    <main
      className="overflow-x-clip"
      style={
        {
          '--color-accent': '#3a5fa8',
          '--color-accent-hover': '#2f4e8d',
          '--color-accent-soft': '#e9effa',
        } as React.CSSProperties
      }
    >
      <noscript>
        <style>{`[data-lp-reveal]{opacity:1 !important;transform:none !important}`}</style>
      </noscript>
      <Nav />
      <Hero />
      <LiveCopilot />
      <HowItWorks />
      <Trust />
      <FinalCta />
      <Footer />
    </main>
  );
}

/* ============================== Nav ============================== */

function Wordmark() {
  return (
    <Link href="/for-doctors" className="inline-flex items-center gap-2.5">
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
      <span className="font-serif text-lg font-semibold tracking-tight">Cureocity Scribe</span>
    </Link>
  );
}

function Nav() {
  const links = [
    { href: '#live', label: 'The live copilot' },
    { href: '#how', label: 'How it works' },
    { href: '#trust', label: 'Trust & DPDP' },
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
            href="/"
            className="text-sm text-[var(--color-ink-2)] transition-colors hover:text-[var(--color-ink)]"
          >
            For therapists
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
            Sign in
          </ButtonLink>
          <ButtonLink href="/login" size="sm">
            Get early access
          </ButtonLink>
        </div>
      </Container>
    </header>
  );
}

/* ============================== Hero ============================== */

function Hero() {
  return (
    <section className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden>
        <div className="lp-blob lp-blob-a left-[-10%] top-[-18%] h-[480px] w-[480px] bg-[#ccd8ee] opacity-70" />
        <div className="lp-blob lp-blob-b right-[-12%] top-[-6%] h-[420px] w-[420px] bg-[#e8e0cf] opacity-60" />
        <div className="lp-blob lp-blob-c left-[28%] top-[30%] h-[360px] w-[360px] bg-[#dde5f2] opacity-60" />
      </div>

      <Container className="grid items-center gap-14 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pb-28 lg:pt-24">
        <div>
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--color-accent)]">
              For Indian doctors · super-specialty OPD
            </p>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="mt-4 font-serif text-5xl leading-[1.04] tracking-tight sm:text-6xl lg:text-[4.2rem]">
              See the patient. The note — and the Rx —{' '}
              <span className="italic text-[var(--color-accent)]">write themselves.</span>
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-ink-2)]">
              Two minutes a patient leaves no time to type. Cureocity Scribe listens, builds the
              note live, and quietly flags the question you haven&rsquo;t asked and the red flag you
              shouldn&rsquo;t miss — in the Hinglish, Manglish, or Tanglish your patients actually
              speak. The prescription drafts itself. You sign.
            </p>
          </Reveal>
          <Reveal delay={260}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/login" size="lg">
                Get early access
              </ButtonLink>
              <ButtonLink href="#live" variant="secondary" size="lg">
                See the live copilot
              </ButtonLink>
            </div>
          </Reveal>
          <Reveal delay={340}>
            <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[var(--color-ink-3)]">
              {[
                'Audio processed in India',
                'Built for 2-minute consults',
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

        <Reveal delay={200}>
          <LiveRailsMock />
        </Reveal>
      </Container>
    </section>
  );
}

/** A static mock of the three live rails — the product's signature view. */
function LiveRailsMock() {
  return (
    <div className="rounded-3xl border border-[var(--color-line)] bg-white p-5 shadow-[0_32px_80px_-36px_rgba(15,27,42,0.25)]">
      <div className="flex items-center justify-between border-b border-[var(--color-line-soft)] pb-3">
        <p className="text-sm font-semibold">Live consult</p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-accent)]" />
          listening
        </span>
      </div>
      <div className="mt-4 space-y-3">
        <RailCard tag="Transcript" tone="muted">
          “…seene mein pressure ho raha tha, do din se. Walking pe zyada.”
        </RailCard>
        <RailCard tag="Note · building" tone="ink">
          <strong>CC:</strong> Exertional chest pressure ×2 days · <strong>HPI:</strong>{' '}
          retrosternal, worse on exertion
        </RailCard>
        <RailCard tag="Ask / flag" tone="accent">
          🔴 Exertional chest pain — consider ECG (ACS red flag) · ❓ not yet asked: radiation,
          sweating, prior cardiac history
        </RailCard>
      </div>
    </div>
  );
}

function RailCard({
  tag,
  tone,
  children,
}: {
  tag: string;
  tone: 'muted' | 'ink' | 'accent';
  children: ReactNode;
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
      : tone === 'ink'
        ? 'border-[var(--color-line)] bg-[var(--color-surface-soft)]'
        : 'border-[var(--color-line-soft)] bg-white';
  return (
    <div className={`rounded-2xl border p-3.5 ${toneClass}`}>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
        {tag}
      </p>
      <p className="text-[13px] leading-relaxed text-[var(--color-ink)]">{children}</p>
    </div>
  );
}

/* ============================== Live copilot ============================== */

const RAILS = [
  {
    tag: 'Rail 1 · Transcript',
    title: 'Word-by-word, in the language spoken',
    body: 'Streaming transcription tuned for Indian code-mix — Hinglish, Manglish, Tanglish. Drug names and dosages preserved exactly, not flattened to English.',
  },
  {
    tag: 'Rail 2 · Note',
    title: 'The note builds as you talk',
    body: 'Chief complaint, HPI, exam, assessment, plan — filled in live, not started after the patient leaves. By “end consult” it is ~90% done.',
  },
  {
    tag: 'Rail 3 · Ask & flag',
    title: 'The question you forgot. The flag you can’t miss.',
    body: 'A quiet sidebar surfaces unasked screening questions, red flags, drug-interaction warnings, and coding nudges — passive and dismissible, never blocking.',
  },
];

function LiveCopilot() {
  return (
    <section
      id="live"
      className="scroll-mt-24 border-y border-[var(--color-line-soft)] bg-white/60 py-20 lg:py-28"
    >
      <Container>
        <SectionHeading
          eyebrow="The live copilot"
          title={
            <>
              Not a scribe that catches up.{' '}
              <span className="italic text-[var(--color-accent)]">A copilot in the room.</span>
            </>
          }
          sub="Most tools record now and write a note in 30 seconds — after the patient is gone. In a two-minute OPD that is too late. Cureocity Scribe runs three live rails the whole consult."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {RAILS.map((r, i) => (
            <Reveal key={r.tag} delay={i * 110}>
              <div className="lp-lift h-full rounded-3xl border border-[var(--color-line)] bg-white p-7">
                <span className="inline-flex items-center rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
                  {r.tag}
                </span>
                <h3 className="mt-4 font-serif text-[22px] leading-snug">{r.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-2)]">
                  {r.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ============================== How it works ============================== */

const STEPS = [
  {
    n: '01',
    title: 'Consult',
    body: 'Tap record — or just dictate. The transcript and the structured note build live as you speak or examine.',
  },
  {
    n: '02',
    title: 'Glance',
    body: 'A passing look at the sidebar: the unasked question, the red flag, the interaction. Act on it while the patient is still in front of you.',
  },
  {
    n: '03',
    title: 'Sign & share',
    body: 'End the consult — the note + prescription are already drafted. Confirm, sign, and send the patient a plain-language after-visit summary on WhatsApp.',
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 py-20 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title={
            <>
              Three moves. <span className="italic text-[var(--color-accent)]">No typing.</span>
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

/* ============================== Trust ============================== */

const TRUST = [
  {
    title: 'Straight answer on your data',
    body: 'Consult audio is transcribed on Indian infrastructure (asia-south1) and never stored. Note structuring runs on Google’s secure global AI service under the patient’s recorded consent — we say exactly where every byte goes.',
  },
  {
    title: 'Every line traceable',
    body: 'Each note line links back to the exact moment in the transcript that produced it. No invented exams, no phantom medications.',
  },
  {
    title: 'You stay in charge',
    body: 'Every diagnosis, prescription, and order is a draft until you sign it. Nothing reaches the record — or the patient — without your confirmation.',
  },
  {
    title: 'ABDM-ready',
    body: 'Built to export FHIR and link prescriptions to the patient’s ABHA, so your notes fit the national digital-health rails.',
  },
];

function Trust() {
  return (
    <section
      id="trust"
      className="scroll-mt-24 border-y border-[var(--color-line-soft)] bg-white/60 py-20 lg:py-28"
    >
      <Container>
        <SectionHeading
          eyebrow="Trust & DPDP"
          title={
            <>
              Built like it&rsquo;s health data.{' '}
              <span className="italic text-[var(--color-accent)]">Because it is.</span>
            </>
          }
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map((c, i) => (
            <Reveal key={c.title} delay={(i % 4) * 90}>
              <div className="lp-lift h-full rounded-3xl border border-[var(--color-line)] bg-white p-7">
                <h3 className="text-base font-semibold">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">{c.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ============================== CTA + footer ============================== */

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
                Give the patient your eyes.{' '}
                <span className="italic">We&rsquo;ll take the notes.</span>
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/80">
                Cureocity Scribe for doctors is in active development. Sign in to set up your
                practice and be among the first super-specialty OPDs to try the live copilot.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <ButtonLink
                  href="/login"
                  size="lg"
                  className="!bg-white !text-[var(--color-accent)] hover:!bg-[var(--color-surface-soft)]"
                >
                  Get early access
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
              The live AI copilot for Indian doctors — built for the two-minute OPD.
            </p>
          </div>
          <div className="flex gap-14">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-3)]">
                Product
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-ink-2)]">
                {[
                  ['#live', 'The live copilot'],
                  ['#how', 'How it works'],
                  ['#trust', 'Trust & DPDP'],
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
                More
              </p>
              <ul className="mt-3 space-y-2 text-sm text-[var(--color-ink-2)]">
                <li>
                  <Link href="/" className="transition-colors hover:text-[var(--color-ink)]">
                    For therapists
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="transition-colors hover:text-[var(--color-ink)]">
                    Sign in
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

/* ============================== shared ============================== */

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
