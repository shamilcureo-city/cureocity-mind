import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Container } from '@/components/ui/Container';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

export const metadata = {
  title: 'For therapists · Cureocity Mind',
  description: 'A practice that does the operations so you can do the work.',
};

export default function ForTherapistsPage() {
  return (
    <>
      <Header />
      <main className="pb-24">
        <section className="relative overflow-hidden pt-16 pb-12 sm:pt-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[460px] max-w-[1180px] rounded-b-[64px] bg-gradient-to-b from-[var(--color-accent-soft)] to-transparent"
          />
          <Container>
            <div className="max-w-3xl">
              <Badge tone="accent" className="mb-6">
                Now accepting therapists
              </Badge>
              <h1 className="font-serif text-[44px] leading-[1.05] sm:text-[56px]">
                The boring parts of a private practice,{' '}
                <span className="italic text-[var(--color-accent)]">handled.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-2)]">
                We bring you well-matched clients, take care of intake and scheduling, and give you
                a quiet place to keep notes. You keep your existing fees. We take no commission on
                your first ten matches.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <ButtonLink href="#apply" size="lg">
                  Apply to join
                </ButtonLink>
                <ButtonLink href="/login" size="lg" variant="secondary">
                  Log in
                </ButtonLink>
              </div>
            </div>
          </Container>
        </section>

        <section className="py-16">
          <Container>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  title: 'Pre-qualified intakes',
                  body: 'Every match arrives with concerns, language preference, and the fit criteria you have set up.',
                },
                {
                  title: 'Notes that respect privacy',
                  body: 'Encrypted by default, with a clear audit log. Yours to read, yours to keep, yours to delete.',
                },
                {
                  title: 'You set the boundaries',
                  body: 'Set your weekly cap, holidays, and walk-in slots. The matching engine respects it.',
                },
                {
                  title: 'Transparent fees',
                  body: 'No commission on your first ten matches. After that, a flat 10% — capped at ₹4,000 per month.',
                },
                {
                  title: 'Direct relationships',
                  body: 'You own the relationship with each client from session one. We never get between you and them.',
                },
                {
                  title: 'A real human, on call',
                  body: 'Care coordinators handle reschedules, gentle no-show follow-ups, and crisis triage.',
                },
              ].map((it) => (
                <Card key={it.title} className="p-6">
                  <h3 className="font-serif text-xl">{it.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">
                    {it.body}
                  </p>
                </Card>
              ))}
            </div>
          </Container>
        </section>

        <section id="tools" className="py-16">
          <Container>
            <div className="rounded-3xl bg-[var(--color-ink)] px-8 py-14 text-white sm:px-14">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-soft)]">
                  Inside the practice
                </p>
                <h2 className="mt-3 font-serif text-4xl leading-tight">
                  Lightweight tools, built with clinicians.
                </h2>
                <p className="mt-4 text-[#cdd6cf]">
                  An inbox of pre-vetted intakes. A clean client roster. Optional ambient session
                  notes that you sign off on. Everything else stays out of your way.
                </p>
              </div>
              <ul className="mt-10 grid gap-4 sm:grid-cols-2">
                {[
                  [
                    'Matching inbox',
                    'Three matches a week, on average. Decline what does not fit.',
                  ],
                  [
                    'Booking auto-pilot',
                    'We confirm intros, send reminders, and handle reschedules.',
                  ],
                  [
                    'Note assist (optional)',
                    'Sign off the draft. We never store an unsigned note.',
                  ],
                  [
                    'DPDP-ready audit log',
                    'Every read and write is logged. Yours to export, yours to delete.',
                  ],
                ].map(([t, b]) => (
                  <li key={t} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <p className="font-serif text-lg">{t}</p>
                    <p className="mt-2 text-sm text-[#cdd6cf]">{b}</p>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>

        <section id="apply" className="py-20">
          <Container>
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
                Apply
              </p>
              <h2 className="mt-3 font-serif text-4xl">Tell us about your practice.</h2>
              <p className="mt-3 text-[var(--color-ink-2)]">
                Send a note to{' '}
                <a
                  href="mailto:therapists@cureocity.mind"
                  className="text-[var(--color-accent)] underline"
                >
                  therapists@cureocity.mind
                </a>{' '}
                with your RCI number, the modalities you work in, and a short paragraph about your
                approach. We will reply within two business days.
              </p>
              <p className="mt-8 text-sm text-[var(--color-ink-3)]">
                Already with us?{' '}
                <Link href="/login" className="text-[var(--color-accent)] underline">
                  Log in to the practice
                </Link>
                .
              </p>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </>
  );
}
