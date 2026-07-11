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
 */
export const metadata: Metadata = {
  title: 'Cureocity Care — your own therapist. Tonight.',
  description:
    'Real voice sessions in your own language — English, हिन्दी, മലയാളം, or the mix you actually speak. A real intake, a plan with goals you choose, weekly sessions with homework, and progress measured honestly. Your therapist is an AI, and we say it plainly.',
};

export default function CareLanding() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] pb-16">
      <nav className="border-b border-[var(--color-line-soft)]">
        <Container className="flex h-16 items-center justify-between">
          <Link href="/care" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--color-accent)] text-white">
              ☾
            </span>
            <span className="font-serif text-lg font-semibold tracking-tight">Cureocity Care</span>
          </Link>
          <ButtonLink href="/care/login" size="sm">
            Sign in
          </ButtonLink>
        </Container>
      </nav>

      <Container className="max-w-3xl">
        <section className="pt-16 text-center">
          <h1 className="mx-auto max-w-xl font-serif text-4xl font-semibold leading-tight sm:text-5xl">
            Your own therapist. Tonight.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--color-ink-2)]">
            Real voice sessions in your own language — English, हिन्दी, മലയാളം, or the mix you
            actually speak. A real plan with goals you choose. Progress you can measure, not just
            feel.
          </p>
          <div className="mt-8">
            <ButtonLink href="/care/login" size="lg">
              Start — first session free
            </ButtonLink>
          </div>
        </section>

        <section className="mt-16 grid gap-3 sm:grid-cols-2">
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
        </section>

        <section className="mt-12 rounded-2xl border border-[var(--color-accent)]/25 bg-[var(--color-accent-soft)] p-6">
          <h2 className="font-serif text-xl font-semibold">Honest, up front</h2>
          <ul className="mt-3 space-y-2 text-[15px] text-[var(--color-ink-2)]">
            <li>
              🤖 Your therapist is an <b className="text-[var(--color-ink)]">AI</b> — not a licensed
              professional, and it never pretends to be.
            </li>
            <li>
              📝 After every session, <b className="text-[var(--color-ink)]">you</b> get the full
              report. Your data stays yours — export or delete any time.
            </li>
            <li>
              🚨 <b className="text-[var(--color-ink)]">Not for emergencies.</b> If you&apos;re in
              crisis, real people are one tap away, below — and inside every session.
            </li>
          </ul>
        </section>

        <section className="mt-8 text-center text-sm text-[var(--color-ink-2)]">
          In crisis right now?{' '}
          <a className="font-semibold underline underline-offset-2" href="tel:9152987821">
            iCall (TISS) 9152987821
          </a>{' '}
          ·{' '}
          <a className="font-semibold underline underline-offset-2" href="tel:18602662345">
            Vandrevala Foundation 1860-2662-345
          </a>
        </section>
      </Container>
    </main>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent)]">
        {n}
      </div>
      <h3 className="mt-1 font-serif text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">{children}</p>
    </div>
  );
}
