import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

/**
 * Static onboarding guide. Five concrete steps that introduce the
 * core therapist surface — no SDK calls, no DB reads; just text the
 * therapist can read on their first login. Sprint 11 turns these
 * into interactive walkthroughs with mock data; today they're
 * structured prose with deep links.
 */
const SECTIONS = [
  {
    n: 1,
    title: 'Add a client',
    body: 'Open the Clients tab on the left, click "+ Create new", and capture name + phone + the three required consents (audio recording, AI note generation, cross-border processing). The client is created immediately and you land on their detail page.',
    cta: { href: '/app/clients', label: 'Open Clients' },
  },
  {
    n: 2,
    title: 'Record a session',
    body: 'From the Record tab, pick the capture mode — virtual session (browser tab audio), in-person (device microphone), or dictate-after (post-session summary). The recorder buffers 30-second PCM chunks to Postgres and survives tab refreshes via IndexedDB.',
    cta: { href: '/app', label: 'Open Record' },
  },
  {
    n: 3,
    title: 'Let the scribe draft the note',
    body: 'When you end the session, the two-pass Vertex Gemini pipeline runs: Pass 1 (Flash in asia-south1) transcribes + diarizes + extracts affect; Pass 2 (Pro on the global endpoint) writes the SOAP note. The Notes tab shows progress and reveals the draft when ready.',
    cta: null,
  },
  {
    n: 4,
    title: 'Modify, sign, share',
    body: 'Use the AI assistant panel to issue plain-text edit instructions ("rewrite the plan as bullets", "remove client names"). Sign off when the note matches your judgement. Download the signed PDF, view the radial mindmap, or generate reflection questions for the client.',
    cta: null,
  },
  {
    n: 5,
    title: 'Track progress with workflows',
    body: 'On the client detail page, start a CBT or EMDR workflow with 1–20 goals. Each completed session feeds the advancement evaluator (CBT) or preparation gate (EMDR). The prescription engine suggests exercises tailored to the current phase; assign them with one click.',
    cta: { href: '/app/clients', label: 'Pick a client' },
  },
] as const;

const SUPPORTING_LINKS = [
  { href: '/app/klara', label: 'Klara — chat with your practice data', desc: 'Ask "which clients haven\'t been seen in 30+ days?" and other roster-aware questions.' },
  { href: '/app/admin/erasure-queue', label: 'DPDP erasure queue', desc: 'Review and resolve § 15 erasure requests within the 30-day statutory window.' },
  { href: '/app/templates', label: 'Note templates', desc: 'Customize note structures beyond the default SOAP layout (ships post-pilot).' },
];

export default function LearnPage() {
  return (
    <Container className="py-10">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent)]">
          Onboarding
        </p>
        <h1 className="mt-2 font-serif text-3xl">Learn Cureocity Mind</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-2)]">
          Five short steps to go from logged in to a signed clinical note. Each section is
          self-contained — skip ahead if the area is already familiar.
        </p>
      </header>

      <ol className="space-y-6">
        {SECTIONS.map((s) => (
          <li key={s.n}>
            <Card className="p-6">
              <header className="flex items-baseline gap-3">
                <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-[var(--color-accent)] font-serif text-sm text-white">
                  {s.n}
                </span>
                <h2 className="font-serif text-xl">{s.title}</h2>
              </header>
              <p className="mt-3 text-sm leading-relaxed text-[var(--color-ink)]">{s.body}</p>
              {s.cta && (
                <div className="mt-4">
                  <Link
                    href={s.cta.href}
                    className="inline-block rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-[var(--color-surface)] hover:bg-[var(--color-ink-2)]"
                  >
                    {s.cta.label} →
                  </Link>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ol>

      <section className="mt-10">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">
          Once you're set up
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {SUPPORTING_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="block rounded-2xl border border-[var(--color-line)] bg-white p-5 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
            >
              <p className="font-serif text-base text-[var(--color-ink)]">{l.label}</p>
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-2)]">{l.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <Card className="mt-10 p-6">
        <h2 className="text-xs uppercase tracking-wide text-[var(--color-ink-3)]">Need help?</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          The Klara assistant is the fastest way to get answers grounded in your data. For
          billing, compliance, and pilot-specific questions, reach out to Sharafath directly.
        </p>
      </Card>
    </Container>
  );
}
