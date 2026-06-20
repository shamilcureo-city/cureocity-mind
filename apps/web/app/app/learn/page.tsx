import Link from 'next/link';
import { Container } from '@/components/ui/Container';
import { Card } from '@/components/ui/Card';

export const dynamic = 'force-dynamic';

/**
 * Static onboarding guide. Five concrete steps that introduce the
 * core therapist surface — no SDK calls, no DB reads; just text the
 * therapist can read on their first login, with deep links into each
 * area of the current product.
 */
const SECTIONS = [
  {
    n: 1,
    title: 'Add a client',
    body: 'Open Clients → New client (or "+ New client" straight from the Record screen). Capture their name and phone, and confirm they\'ve agreed to audio recording and AI note generation. Everything else — email, languages, presenting concerns — you can fill in later from their client page; the intake itself surfaces most of it.',
    cta: { href: '/app/clients', label: 'Open Clients' },
  },
  {
    n: 2,
    title: 'Record a session',
    body: "From Record, pick who you're with. The pre-flight reads their history and works out whether this is an intake, a treatment session, or a plan review — you just confirm and start. Capture by device microphone (in person), browser-tab audio (virtual), or upload a file. Audio is chunked as you go and survives a tab refresh.",
    cta: { href: '/app', label: 'Open Record' },
  },
  {
    n: 3,
    title: 'The AI drafts your note',
    body: "When you end the session the Vertex Gemini pipeline transcribes and diarizes the audio, then writes the note — a SOAP note for treatment sessions, a structured intake note for a first session. The Notes tab shows progress and reveals the draft when it's ready.",
    cta: null,
  },
  {
    n: 4,
    title: 'Review with the AI Copilot',
    body: 'Open the AI Copilot tab for the clinical brief — diagnosis candidates with ICD-11 codes and supporting evidence, the case formulation, recommended therapies with step-by-step scripts, and a mindmap. You accept, edit, or reject each suggestion; confirmed diagnoses and treatment plans build up across sessions.',
    cta: null,
  },
  {
    n: 5,
    title: 'Sign, measure, share',
    body: "Sign the note when it matches your judgement and download the PDF for your records. Administer PHQ-9 / GAD-7 to track change against validated thresholds, follow the client's Journey from intake through to discharge, and share a plain-language progress report or reflection questions with the client over WhatsApp, email, or a private portal link.",
    cta: { href: '/app/clients', label: 'Pick a client' },
  },
] as const;

const SUPPORTING_LINKS = [
  {
    href: '/app/practice-assistant',
    label: 'Practice Assistant — chat with your practice data',
    desc: 'Ask "which clients haven\'t been seen in 30+ days?" and other roster-aware questions.',
  },
  {
    href: '/app/me',
    label: 'My practice',
    desc: 'Your own tempo and decision split — for self-reflection, not comparison.',
  },
  {
    href: '/app/admin/erasure-queue',
    label: 'DPDP erasure queue',
    desc: 'Review and resolve § 15 erasure requests within the 30-day statutory window.',
  },
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
          The Practice Assistant is the fastest way to get answers grounded in your data. For
          billing, compliance, and pilot-specific questions, reach out to Sharafath directly.
        </p>
      </Card>
    </Container>
  );
}
