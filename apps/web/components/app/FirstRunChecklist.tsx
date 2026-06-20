import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { DemoClientButton } from '@/components/app/DemoClientButton';
import { prisma } from '@/lib/prisma';

interface Props {
  psychologistId: string;
}

interface Step {
  label: string;
  done: boolean;
  hint: string;
  href?: string;
  /** When set, render this slot in place of the default "Go →" link. */
  customCta?: 'demo';
  /** Existing demo client id, used by the demo CTA. */
  demoClientId?: string | null;
}

/**
 * Sprint 31 — first-run "what to try next" checklist on /app.
 *
 * Renders only while at least one core-loop milestone is unmet, then
 * disappears for good. State is derived live from the DB so it's
 * accurate whether the therapist did things from this device or
 * another, and there's no flag to persist or invalidate. Profile
 * completion is implicit by the time `/app` renders (the onboarding
 * gate guarantees it), so the four steps below are the next loops.
 */
export async function FirstRunChecklist({ psychologistId }: Props) {
  // Sprint 48 — the showcase "Example" client must not check off the
  // user's own getting-started steps; the demo arc is its own thing.
  const [clients, sessions, signedNotes, shares, demoClient] = await Promise.all([
    prisma.client.count({ where: { psychologistId, deletedAt: null, isDemo: false } }),
    prisma.session.count({
      where: { psychologistId, status: 'COMPLETED', client: { isDemo: false } },
    }),
    prisma.therapyNote.count({
      where: { session: { psychologistId, client: { isDemo: false } } },
    }),
    prisma.patientShare.count({ where: { psychologistId, client: { isDemo: false } } }),
    prisma.client.findFirst({
      where: { psychologistId, isDemo: true, deletedAt: null },
      select: { id: true },
    }),
  ]);

  const steps: Step[] = [
    {
      label: 'Explore the example client',
      done: demoClient !== null,
      hint: 'Seed a fully-arced demo client (signed intake, 5 sessions, PHQ-9 trend, progress report) to see the full co-pilot in one click.',
      customCta: 'demo',
      demoClientId: demoClient?.id ?? null,
    },
    {
      label: 'Add your first client',
      done: clients > 0,
      hint: 'Their record holds sessions, instruments, and shares.',
      href: '/app/clients',
    },
    {
      label: 'Record your first session',
      done: sessions > 0,
      hint: 'Pick a client above and tap Start.',
    },
    {
      label: 'Sign your first note',
      done: signedNotes > 0,
      hint: 'Review the SOAP draft, then Sign off.',
    },
    {
      label: 'Share a note with your client',
      done: shares > 0,
      hint: 'WhatsApp or email — they read it on the patient portal.',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Card className="mt-10 p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-accent)]">
            Getting started
          </p>
          <h2 className="mt-1 font-serif text-xl">
            {doneCount} of {steps.length} done
          </h2>
        </div>
        <p className="text-xs text-[var(--color-ink-3)]">
          This card hides itself once you finish the loop.
        </p>
      </header>

      <ul className="mt-5 space-y-2">
        {steps.map((s) => (
          <li
            key={s.label}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm transition-colors ${
              s.done
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40'
                : 'border-[var(--color-line)] bg-white'
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                s.done
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'border border-[var(--color-line)] bg-white text-[var(--color-ink-3)]'
              }`}
            >
              {s.done ? '✓' : ''}
            </span>
            <div className="flex-1">
              <p
                className={`font-medium ${
                  s.done ? 'text-[var(--color-ink-3)] line-through' : 'text-[var(--color-ink)]'
                }`}
              >
                {s.label}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-ink-3)]">{s.hint}</p>
            </div>
            {s.customCta === 'demo' ? (
              <DemoClientButton demoClientId={s.demoClientId ?? null} variant="cta" />
            ) : s.href && !s.done ? (
              <Link
                href={s.href}
                className="self-center text-xs font-medium text-[var(--color-accent)] hover:underline"
              >
                Go →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
