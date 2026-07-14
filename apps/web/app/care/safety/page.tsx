import type { Metadata } from 'next';
import Link from 'next/link';
import { crisisResources } from '@/lib/care-safety';
import { Card } from '@/components/ui/Card';

export const metadata: Metadata = {
  title: 'How safety works — Cureocity Care',
  description:
    'When things get heavy, the AI stops being clever. Exactly what happens on a crisis signal, published in plain language.',
};

/**
 * CG5 — /care/safety, honesty-as-hook (docs/CARE_GROWTH_SYSTEM.md §8).
 * Publishes BEHAVIOURS and guarantees — never the keyword lexicon,
 * thresholds, or anything bypass-relevant (crisis-screened populations
 * demonstrably learn to evade published triggers).
 */
export default function CareSafetyPage() {
  const resources = crisisResources(['en', 'hi']);
  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 md:max-w-2xl">
      <h1 className="font-serif text-3xl font-semibold">
        When things get heavy, the AI stops being clever.
      </h1>
      <p className="mt-3 text-[15px] text-[var(--color-ink-2)]">
        Cureocity Care is an AI therapist, and an AI cannot handle an emergency. So the product is
        built the other way around: distress pauses the AI and puts people first. Here is exactly
        how that behaves — published, because you shouldn&apos;t have to trust a black box with
        this.
      </p>

      <Card className="mt-6 space-y-3 p-4 text-sm">
        <p>
          <b>The ⚠ button is always there.</b> Every session screen carries a one-tap &ldquo;Need
          urgent help?&rdquo; button at the bottom. Tapping it stops the session and shows real
          people to call — immediately, no questions.
        </p>
        <p>
          <b>The session listens for danger.</b> If a conversation raises self-harm, harm to others,
          abuse, or a medical emergency — whether the AI notices it or our independent screening
          does — the session pauses, the AI says so plainly, and the same human hotlines take over
          the screen.
        </p>
        <p>
          <b>Check-ins are screened too.</b> The clinical questionnaires include a question about
          thoughts of self-harm. A raised answer is treated exactly like a crisis in a session:
          people first, immediately.
        </p>
        <p>
          <b>Afterwards, sessions pause — briefly, deliberately.</b> After any crisis signal the
          account takes a breather: sessions stay paused until the next day&apos;s check-in says
          things are steadier. Everything you made — your plan, your reports — stays saved and
          waiting. Nothing about safety is ever behind a paywall, on any tier.
        </p>
        <p>
          <b>Nothing pings you during a pause.</b> Reminders, streaks, offers — all of it goes
          silent while the account is held. The only voice during a hold is the safety machinery
          itself. Every suppressed message is recorded, so this promise is auditable, not
          rhetorical.
        </p>
      </Card>

      <Card className="mt-4 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          The people, right now
        </span>
        <ul className="mt-2 space-y-1.5">
          {resources.map((r) => (
            <li key={r.number}>
              <a href={`tel:${r.number}`} className="font-semibold underline-offset-2">
                {r.name} — {r.number}
              </a>{' '}
              <span className="text-[var(--color-ink-3)]">({r.hours})</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--color-ink-3)]">
          Free and confidential. In an immediate emergency, contact local emergency services.
        </p>
      </Card>

      <Card className="mt-4 p-4 text-sm">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-ink-3)]">
          Oversight &amp; your rights
        </span>
        <p className="mt-2">
          Crisis-pause transcripts are reviewed under clinical oversight, and the crisis phrase
          lists are clinician-signed — additions any time, removals only with sign-off. Your data is
          yours: export or delete everything from Settings, any time. Questions or grievances:{' '}
          <a href="mailto:care@cureocity.in" className="font-semibold underline-offset-2">
            care@cureocity.in
          </a>
          .
        </p>
      </Card>

      <p className="mt-6 text-center">
        <Link
          href="/care"
          className="text-sm text-[var(--color-ink-3)] underline-offset-2 hover:underline"
        >
          ← About Cureocity Care
        </Link>
      </p>
      <p className="mt-6 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
        Cureocity Care is AI software, not a person, and not a replacement for professional mental
        healthcare. It does not provide medical diagnosis or treatment.
      </p>
    </main>
  );
}
