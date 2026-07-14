import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/**
 * CG5 — the intent-landing template (docs/CARE_GROWTH_SYSTEM.md §8): one
 * calm page per high-intent search moment (/care/sleep, /care/exam-stress,
 * /care/cant-afford-therapy). English-only for now — the multilingual
 * pages wait for human-reviewed copy (the no-machine-translation rule
 * extends to marketing pages that make clinical-adjacent claims). Server
 * component; the shared chrome keeps every page honest: AI disclosure,
 * the true free tier, the crisis strip.
 */

export interface CareIntentContent {
  hero: string;
  sub: string;
  points: Array<{ title: string; body: string }>;
  cta: string;
}

export function CareIntentLanding({
  content,
  signupsOpen,
}: {
  content: CareIntentContent;
  signupsOpen: boolean;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-10 md:max-w-2xl">
      <p className="text-[13px] text-[var(--color-ink-3)]">
        <Link href="/care" className="underline-offset-2 hover:underline">
          Cureocity Care
        </Link>{' '}
        · an AI therapist — we never pretend otherwise
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold leading-tight md:text-4xl">
        {content.hero}
      </h1>
      <p className="mt-3 text-[15px] text-[var(--color-ink-2)]">{content.sub}</p>

      <div className="mt-6 space-y-3">
        {content.points.map((p) => (
          <Card key={p.title} className="p-4 text-sm">
            <b>{p.title}</b>
            <p className="mt-1 text-[var(--color-ink-2)]">{p.body}</p>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        {signupsOpen ? (
          <ButtonLink href="/care/login" size="lg" className="w-full">
            {content.cta}
          </ButtonLink>
        ) : (
          <ButtonLink href="/care" size="lg" variant="secondary" className="w-full">
            Join the waitlist →
          </ButtonLink>
        )}
        <p className="mt-2 text-center text-[12px] text-[var(--color-ink-3)]">
          2 free sessions every week — not a trial. Human therapy in India runs ₹800–3,500 a
          session; Care is an AI, not a replacement for a therapist — that&apos;s part of why
          it&apos;s free to start.
        </p>
      </div>

      <p className="mt-4 text-center">
        <Link
          href="/care/check"
          className="text-sm font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          Not sure? Take the 2-minute check — no sign-up →
        </Link>
      </p>

      <p className="mt-8 text-[11px] leading-relaxed text-[var(--color-ink-3)]">
        In crisis? iCall 9152987821 · Vandrevala 1860-2662-345 — free, confidential. Cureocity Care
        is AI software, not a person, not medical diagnosis or treatment, and not for emergencies.
      </p>
    </main>
  );
}
