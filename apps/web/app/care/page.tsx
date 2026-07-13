import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { Container } from '@/components/ui/Container';

/**
 * Sprint AC1 — the Cureocity Care consumer landing (`/care`).
 *
 * The third face of the product (therapist `/`, doctor `/for-doctors`,
 * consumer `/care`). Honest copy only: the therapist is an AI and the
 * page says so above the fold, next to the hotline strip. The promise
 * is the ARC — a real first session, an assessment & plan you approve,
 * weekly sessions, progress you can measure — not vibes.
 *
 * Web-first layout (full-width, multi-column) that collapses to a single
 * calm column on phones — the app itself is where the mobile-first voice
 * flow lives.
 */
export const metadata: Metadata = {
  title: 'Cureocity Care — your own therapist. Tonight.',
  description:
    'Real voice sessions in your own language — English, हिन्दी, മലയാളം, or the mix you actually speak. A real intake, a plan with goals you choose, weekly sessions with homework, and progress measured honestly. Your therapist is an AI, and we say it plainly.',
};

export default function CareLanding() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)]">
      <nav className="border-b border-[var(--color-line-soft)]">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/care" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent)] text-white">
              ☾
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">Cureocity Care</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="#how"
              className="hidden text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)] sm:block"
            >
              How it works
            </Link>
            <Link
              href="/care/login"
              className="text-sm text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            >
              Sign in
            </Link>
            <ButtonLink href="/care/login" size="sm">
              Start free
            </ButtonLink>
          </div>
        </Container>
      </nav>

      {/* Hero — two columns on desktop, stacked on phones. */}
      <Container className="grid items-center gap-10 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-24">
        <section>
          <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1 text-[13px] text-[var(--color-ink-2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            An AI therapist — in the language you actually speak
          </span>
          <h1 className="mt-5 font-serif text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Your own therapist.
            <br className="hidden sm:block" /> Tonight.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--color-ink-2)]">
            Real voice sessions in English, हिन्दी, മലയാളം — or the mix you actually speak. A real
            intake, a plan with goals you choose, weekly sessions with homework, and progress you
            can measure. Not a chatbot that agrees with you.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href="/care/login" size="lg">
              Start — first session free
            </ButtonLink>
            <ButtonLink href="#how" size="lg" variant="secondary">
              See how it works
            </ButtonLink>
          </div>
          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-ink-3)]">
            <span>🤖 Your therapist is an AI — we never pretend otherwise</span>
            <span className="hidden sm:inline">·</span>
            <span>🔒 Your data stays yours</span>
          </p>
        </section>

        <SessionPreview />
      </Container>

      {/* The arc — the actual promise, four steps. */}
      <div id="how" className="scroll-mt-20" />
      <Container className="pt-24">
        <div className="max-w-2xl">
          <h2 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
            A real arc — not just someone to vent to
          </h2>
          <p className="mt-3 text-lg text-[var(--color-ink-2)]">
            The same shape a good human therapist follows: understand you first, agree a plan, do
            the work weekly, and check honestly whether it&apos;s helping.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Step n="1" title="A real first session">
            Your therapist listens — what&apos;s going on, how long, what it&apos;s costing you. A
            conversation, not a form.
          </Step>
          <Step n="2" title="Your assessment & plan">
            What&apos;s happening in plain words, and goals you edit and approve. Nothing is decided
            without you.
          </Step>
          <Step n="3" title="Weekly sessions + homework">
            Evidence-based work — CBT thought records, activation, grounding, sleep — one small
            practice at a time.
          </Step>
          <Step n="4" title="Progress, measured honestly">
            PHQ-9 / GAD-7 check-ins scored by a validated engine. &ldquo;Real change, not
            noise&rdquo; — or the honest opposite.
          </Step>
        </div>
      </Container>

      {/* Honest, up front — three columns on desktop. */}
      <Container className="pt-24">
        <div className="rounded-3xl border border-[var(--color-accent)]/20 bg-[var(--color-accent-soft)] p-8 sm:p-10">
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">Honest, up front</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <Honest icon="🤖" title="It's an AI — and it says so">
              Your therapist is an AI, not a licensed professional, and it never pretends to be. It
              knows its limits and tells you when a human is the right next step.
            </Honest>
            <Honest icon="📝" title="Your data is yours">
              After every session you get the full report. Export or delete everything, any time —
              sessions, reports, and plan included.
            </Honest>
            <Honest icon="🚨" title="Not for emergencies">
              If you&apos;re in crisis, real people are one tap away — on this page below, and
              inside every single session.
            </Honest>
          </div>
        </div>
      </Container>

      {/* Languages — the code-mix promise. */}
      <Container className="pt-24 text-center">
        <h2 className="font-serif text-2xl font-semibold sm:text-3xl">
          In the language you actually think in
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--color-ink-2)]">
          Manglish, Hinglish, Tanglish — real people don&apos;t speak in one language, and neither
          does your therapist.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5">
          {['English', 'हिन्दी', 'മലയാളം', 'தமிழ்', 'বাংলা', 'Manglish', 'Hinglish'].map((l) => (
            <span
              key={l}
              className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-1.5 text-sm text-[var(--color-ink-2)]"
            >
              {l}
            </span>
          ))}
        </div>
      </Container>

      {/* Final CTA. */}
      <Container className="pt-24">
        <div className="flex flex-col items-center gap-6 rounded-3xl bg-[var(--color-ink)] px-8 py-14 text-center text-white sm:py-16">
          <h2 className="max-w-2xl font-serif text-3xl font-semibold leading-tight sm:text-4xl">
            The first session is free. Tonight is a good time to start.
          </h2>
          <ButtonLink
            href="/care/login"
            size="lg"
            className="!bg-white !text-[var(--color-ink)] hover:!bg-white/90"
          >
            Start — first session free
          </ButtonLink>
        </div>
      </Container>

      {/* Footer — crisis line is chrome, not a banner. */}
      <footer className="mt-24 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)]">
        <Container className="py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent)] text-white">
                ☾
              </span>
              <span className="font-serif text-lg font-semibold tracking-tight">
                Cureocity Care
              </span>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--color-ink-2)]">
              <Link href="#how" className="hover:text-[var(--color-ink)]">
                How it works
              </Link>
              <Link href="/care/login" className="hover:text-[var(--color-ink)]">
                Sign in
              </Link>
              <Link href="/" className="hover:text-[var(--color-ink)]">
                For therapists
              </Link>
              <Link href="/for-doctors" className="hover:text-[var(--color-ink)]">
                For doctors
              </Link>
            </div>
          </div>
          <div className="mt-8 rounded-2xl border border-[var(--color-warn)]/25 bg-[var(--color-warn-soft)] p-4 text-sm text-[#7c4322]">
            <b className="font-semibold">In crisis right now?</b> This app is not for emergencies.{' '}
            <a className="font-semibold underline underline-offset-2" href="tel:9152987821">
              iCall (TISS) 9152987821
            </a>{' '}
            ·{' '}
            <a className="font-semibold underline underline-offset-2" href="tel:18602662345">
              Vandrevala Foundation 1860-2662-345
            </a>
          </div>
          <p className="mt-6 text-xs text-[var(--color-ink-3)]">
            Cureocity Care is an AI wellbeing tool. It is not a licensed clinician, does not provide
            medical or emergency care, and does not replace professional treatment.
          </p>
        </Container>
      </footer>
    </main>
  );
}

/** One arc step. */
function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">
        {n}
      </div>
      <h3 className="mt-1 font-serif text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-2)]">{children}</p>
    </div>
  );
}

/** One "honest, up front" column. */
function Honest({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-2xl">{icon}</div>
      <h3 className="mt-2 font-serif text-lg font-semibold text-[var(--color-ink)]">{title}</h3>
      <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--color-ink-2)]">{children}</p>
    </div>
  );
}

/**
 * A calm, static preview of the live voice session — echoes the real
 * in-session surface (dark #101d1a, the pulsing orb, a caption line) so
 * the hero shows the actual product, not a stock illustration. Pure CSS,
 * no assets (the /care CSP forbids external images).
 */
function SessionPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="overflow-hidden rounded-[2rem] border border-[var(--color-line)] bg-[#101d1a] p-6 shadow-2xl shadow-black/20 sm:p-8">
        <div className="flex items-center justify-between text-[13px] text-[#8fb8a6]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#5fd39b]" />
            Live · with Meera
          </span>
          <span className="tabular-nums">24:12</span>
        </div>

        <div className="mt-10 flex flex-col items-center">
          <div className="relative grid h-28 w-28 place-items-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#5fd39b]/10" />
            <span className="absolute inset-3 rounded-full bg-[#5fd39b]/15" />
            <span className="grid h-16 w-16 place-items-center rounded-full bg-[#5fd39b]/90 text-2xl text-[#0b1512]">
              ☾
            </span>
          </div>
          <p className="mt-8 max-w-xs text-center text-[15px] leading-relaxed text-[#dcebe3]">
            &ldquo;So the week starts costing you before it even begins. Has it always been like
            this, or did something shift?&rdquo;
          </p>
        </div>

        <div className="mt-10 flex items-center justify-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-[#dcebe3]">
            🎙
          </span>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-[#dcebe3]">
            💬
          </span>
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#e57373] text-white">
            ✕
          </span>
        </div>
      </div>

      {/* A peek of the plan that comes after — the "you approve it" moment. */}
      <div className="mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-lg shadow-black/5">
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Your plan · v1
        </div>
        <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-ink)]">
          <li className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--color-accent)]" />
            Wind down before 1am, four nights a week
          </li>
          <li className="flex items-center gap-2">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--color-accent)]" />A
            Sunday-evening toolkit for the dread
          </li>
        </ul>
      </div>
    </div>
  );
}
