import Link from 'next/link';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { Container } from '@/components/ui/Container';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TherapistCard } from '@/components/therapist/TherapistCard';
import { fetchPublicTherapists } from '@/lib/directory';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const featured = await fetchPublicTherapists({ acceptingOnly: true }, 4).catch(() => []);

  return (
    <>
      <Header />
      <main>
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <FeaturedTherapists therapists={featured} />
        <ForTherapists />
        <Faq />
        <CrisisBanner />
      </main>
      <Footer />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-12 pb-20 sm:pt-20 sm:pb-28">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-[520px] max-w-[1180px] rounded-b-[64px] bg-gradient-to-b from-[var(--color-accent-soft)] to-transparent"
      />
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <Badge tone="accent" className="mb-6">
              Now matching across India
            </Badge>
            <h1 className="font-serif text-[44px] leading-[1.05] tracking-tight sm:text-[60px]">
              Talk to someone{' '}
              <span className="italic text-[var(--color-accent)]">who gets it.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-ink-2)]">
              Tell us what is on your mind. We will match you with a vetted therapist who works the
              way you want — same week, in your language, online or in person.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href="/get-started" size="lg">
                Find my therapist
              </ButtonLink>
              <ButtonLink href="/therapists" size="lg" variant="secondary">
                Browse the directory
              </ButtonLink>
            </div>
            <p className="mt-6 text-sm text-[var(--color-ink-3)]">
              Free 15-minute introductory call · No card to start · Cancel anytime
            </p>
          </div>
          <HeroIllustration />
        </div>
      </Container>
    </section>
  );
}

function HeroIllustration() {
  return (
    <div className="relative">
      <div className="rounded-3xl border border-[var(--color-line)] bg-white p-6 shadow-[0_24px_60px_-32px_rgba(15,27,42,0.18)]">
        <div className="rounded-2xl bg-[var(--color-surface-soft)] p-5">
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--color-ink-3)]">
            Matching for Anika · Bengaluru
          </p>
          <p className="mt-3 font-serif text-2xl leading-snug text-[var(--color-ink)]">
            “I feel anxious before every meeting, and it spills into my evenings.”
          </p>
        </div>
        <ul className="mt-5 space-y-3">
          {[
            { name: 'Dr. Rohan Sharma', tag: 'CBT · Anxiety', match: '94%' },
            { name: 'Lakshmi Iyer', tag: 'Psychodynamic · Workplace', match: '88%' },
            { name: 'Aisha Khan', tag: 'ACT · Mindfulness', match: '82%' },
          ].map((m) => (
            <li
              key={m.name}
              className="flex items-center justify-between rounded-xl border border-[var(--color-line-soft)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{m.name}</p>
                <p className="text-xs text-[var(--color-ink-3)]">{m.tag}</p>
              </div>
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
                {m.match}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="absolute -bottom-6 -left-6 hidden rotate-[-3deg] rounded-2xl border border-[var(--color-line)] bg-white px-4 py-3 shadow-[0_12px_36px_-18px_rgba(15,27,42,0.25)] sm:block">
        <p className="text-xs text-[var(--color-ink-3)]">First call booked</p>
        <p className="text-sm font-medium">Thursday · 7:30 PM</p>
      </div>
    </div>
  );
}

function TrustStrip() {
  const items = [
    'Verified RCI-registered therapists',
    'Confidential by default',
    'Sliding-scale options',
    'Hindi · English · regional languages',
  ];
  return (
    <section className="border-y border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] py-5">
      <Container>
        <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-2 text-sm text-[var(--color-ink-2)]">
          {items.map((it) => (
            <li key={it} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              {it}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      step: '01',
      title: 'Tell us what you are working through',
      body: 'A short, private intake. What you want help with, how you prefer to work, when you are free.',
    },
    {
      step: '02',
      title: 'See your top three matches',
      body: 'We hand-match using your answers, the therapist’s specialties, and current availability — usually within a day.',
    },
    {
      step: '03',
      title: 'Start with a free intro call',
      body: 'A 15-minute call to check the fit. If it is right, book your first session. If not, we keep looking — at no cost.',
    },
  ];
  return (
    <section id="how-it-works" className="py-24">
      <Container>
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            How it works
          </p>
          <h2 className="mt-3 font-serif text-4xl leading-tight">
            Therapy that respects your time, your context, and your money.
          </h2>
          <p className="mt-4 text-[var(--color-ink-2)]">
            No endless directory scrolling. No insurance maze. Just thoughtful matching by someone
            who has done this before.
          </p>
        </div>
        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.step} className="rounded-2xl border border-[var(--color-line)] bg-white p-7">
              <p className="font-serif text-3xl text-[var(--color-accent)]">{s.step}</p>
              <h3 className="mt-4 font-serif text-xl leading-snug">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">{s.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

function FeaturedTherapists({
  therapists,
}: {
  therapists: Awaited<ReturnType<typeof fetchPublicTherapists>>;
}) {
  if (therapists.length === 0) return null;
  return (
    <section className="py-20">
      <Container>
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
              The practice
            </p>
            <h2 className="mt-3 font-serif text-4xl leading-tight">
              A small team of therapists, individually vetted.
            </h2>
          </div>
          <Link
            href="/therapists"
            className="text-sm font-medium text-[var(--color-accent)] hover:underline"
          >
            See all therapists →
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {therapists.map((t) => (
            <TherapistCard key={t.id} therapist={t} />
          ))}
        </div>
      </Container>
    </section>
  );
}

function ForTherapists() {
  return (
    <section id="about" className="py-24">
      <Container>
        <div className="rounded-3xl bg-[var(--color-ink)] px-8 py-16 sm:px-14">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
            <div className="text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-soft)]">
                For therapists
              </p>
              <h2 className="mt-3 font-serif text-4xl leading-tight">
                Spend more time with clients. Less time on the rest.
              </h2>
              <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#cdd6cf]">
                Cureocity Mind handles intake, matching, scheduling, and notes so you can focus on
                the hour that matters. No platform fees on your first ten matches.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <ButtonLink href="/for-therapists" variant="primary" size="md">
                  Apply to join
                </ButtonLink>
                <ButtonLink href="/login" variant="secondary" size="md">
                  Therapist log in
                </ButtonLink>
              </div>
            </div>
            <ul className="grid grid-cols-2 gap-3 text-sm text-white">
              {[
                { k: '15 min', v: 'average time from intake to first match' },
                { k: '₹0', v: 'platform fee on your first 10 matches' },
                { k: '92%', v: 'of our matches book a second session' },
                { k: '7 cities', v: 'and growing — including online-only' },
              ].map((s) => (
                <li key={s.k} className="rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="font-serif text-2xl">{s.k}</p>
                  <p className="mt-1 text-xs leading-snug text-[#cdd6cf]">{s.v}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Faq() {
  const items = [
    {
      q: 'How much does therapy cost on Cureocity Mind?',
      a: 'Most sessions are between ₹1,200 and ₹3,000 depending on the therapist’s experience. Several therapists offer sliding-scale fees — filter for those on the directory.',
    },
    {
      q: 'Is everything confidential?',
      a: 'Yes. Your intake is encrypted. Only the therapists matched to you can see your details, and only after you accept the match.',
    },
    {
      q: 'What if the first therapist is not the right fit?',
      a: 'The first 15-minute call is on us. If it is not the right fit, tell us — we will keep matching until it is, at no cost.',
    },
    {
      q: 'Do you take insurance?',
      a: 'Some of our therapists are empanelled with corporate EAP programmes. We are adding direct insurance support in 2026.',
    },
  ];
  return (
    <section className="py-24">
      <Container>
        <div className="mx-auto max-w-3xl">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
            Questions, answered
          </p>
          <h2 className="mt-3 text-center font-serif text-4xl leading-tight">
            What people usually want to know.
          </h2>
          <div className="mt-10 divide-y divide-[var(--color-line)] rounded-2xl border border-[var(--color-line)] bg-white">
            {items.map((it) => (
              <details key={it.q} className="group px-6 py-5">
                <summary className="flex cursor-pointer items-start justify-between gap-4 list-none">
                  <span className="font-medium text-[var(--color-ink)]">{it.q}</span>
                  <span
                    aria-hidden
                    className="mt-1 text-[var(--color-accent)] transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink-2)]">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}

function CrisisBanner() {
  return (
    <section id="crisis" className="pb-4">
      <Container>
        <div className="rounded-2xl border border-[var(--color-warn-soft)] bg-[var(--color-warn-soft)] px-6 py-5 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <p className="text-sm text-[var(--color-warn)]">
            <strong>In a crisis right now?</strong> Cureocity Mind is not an emergency service. If
            you are thinking about hurting yourself, call iCall (9152987821) or Vandrevala
            Foundation (1860-2662-345) — both 24×7, free.
          </p>
          <Link
            href="/#crisis-resources"
            className="mt-3 inline-flex shrink-0 text-sm font-medium text-[var(--color-warn)] underline sm:mt-0"
          >
            See local crisis lines
          </Link>
        </div>
      </Container>
    </section>
  );
}
